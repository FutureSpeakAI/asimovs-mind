#!/usr/bin/env python3
"""
Gemini MCP Server — Agent Friday's creative capabilities.

Provides image generation (Nano Banana Pro), text generation, vision analysis,
text-to-speech, creative remixing, generative code art, video generation (Veo),
and music generation (Lyria) via the Gemini API.

Uses the google-genai SDK (NOT the deprecated google-generativeai).

NOTE: Heavy imports (google-genai, Pillow) are deferred to first tool call
so the MCP stdio handshake completes quickly and Claude Desktop doesn't
time out waiting for the server to initialize.
"""

import os
import sys
import io
import base64
import struct
import time
import wave
import logging
from pathlib import Path
from typing import Optional
from datetime import datetime

# FastMCP is lightweight — import eagerly so the server can start immediately.
from mcp.server.fastmcp import FastMCP

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

API_KEY = os.environ.get("GEMINI_API_KEY")
if not API_KEY:
    print("ERROR: GEMINI_API_KEY environment variable is not set.", file=sys.stderr)
    sys.exit(1)

DEFAULT_OUTPUT_DIR = os.environ.get(
    "FRIDAY_CREATIONS_DIR",
    str(Path.home() / "Desktop" / "friday-creations"),
)
Path(DEFAULT_OUTPUT_DIR).mkdir(parents=True, exist_ok=True)

# Logging — stderr only (stdout is reserved for stdio transport)
logging.basicConfig(
    stream=sys.stderr,
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger("gemini_mcp")

# ---------------------------------------------------------------------------
# Lazy-loaded heavy dependencies
# ---------------------------------------------------------------------------

_client = None
_types = None
_Image = None


def _get_client():
    """Lazy-initialize the google-genai client on first use."""
    global _client, _types
    if _client is None:
        log.info("Loading google-genai SDK (first use)...")
        from google import genai
        from google.genai import types as _t
        _types = _t
        _client = genai.Client(api_key=API_KEY)
        log.info("google-genai SDK loaded and client initialized.")
    return _client


def _get_types():
    """Get the google.genai.types module (lazy-loaded)."""
    global _types
    if _types is None:
        _get_client()  # This also sets _types
    return _types


def _get_pil_image():
    """Lazy-load PIL.Image."""
    global _Image
    if _Image is None:
        from PIL import Image as _I
        _Image = _I
    return _Image


# ---------------------------------------------------------------------------
# Model constants
# ---------------------------------------------------------------------------

# Verified against ListModels API — these are the actual model IDs
IMAGE_MODEL = "gemini-2.5-flash-image"              # Stable image gen (tested & working)
IMAGE_MODEL_NANO_PRO = "gemini-3-pro-image-preview"  # Nano Banana Pro
TEXT_MODEL = "gemini-2.5-pro"
VISION_MODEL = "gemini-2.5-flash-image"              # Also good for vision
TTS_MODEL = "gemini-2.5-flash-preview-tts"
VIDEO_MODEL = "veo-3.1-generate-preview"
VIDEO_MODEL_FAST = "veo-3.1-fast-generate-preview"
VIDEO_MODEL_LITE = "veo-3.1-lite-generate-preview"
MUSIC_MODEL = "lyria-3-pro-preview"
MUSIC_CLIP_MODEL = "lyria-3-clip-preview"

# Image models to try in order of preference
IMAGE_MODELS_TO_TRY = [
    "gemini-3-pro-image-preview",     # Nano Banana Pro (best quality)
    "gemini-3.1-flash-image-preview", # Nano Banana 2 (fast)
    "gemini-2.5-flash-image",         # Stable fallback (tested working)
]

# ---------------------------------------------------------------------------
# MCP Server
# ---------------------------------------------------------------------------

mcp = FastMCP("gemini_mcp")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _timestamp_filename(prefix: str, ext: str) -> str:
    """Generate a timestamped filename like 'prefix_20260408_132045.ext'."""
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{prefix}_{ts}.{ext}"


def _resolve_output_path(output_path: Optional[str], prefix: str, ext: str) -> str:
    """Return an absolute output path, creating parent dirs as needed."""
    if output_path:
        p = Path(output_path)
    else:
        p = Path(DEFAULT_OUTPUT_DIR) / _timestamp_filename(prefix, ext)
    p.parent.mkdir(parents=True, exist_ok=True)
    return str(p)


def _aspect_ratio_from_dims(width: Optional[int], height: Optional[int]) -> str:
    """Determine aspect ratio string from pixel dimensions."""
    if not width or not height:
        return "1:1"
    ratio = width / height
    if ratio > 1.3:
        return "16:9"
    elif ratio < 0.77:
        return "9:16"
    return "1:1"


async def _generate_image(prompt: str, aspect_ratio: str = "1:1") -> bytes:
    """Generate an image using Gemini's native image generation.

    Tries multiple model names in order of preference until one works.
    Returns raw image bytes (PNG/JPEG).
    """
    client = _get_client()
    types = _get_types()
    last_error = None

    for model_name in IMAGE_MODELS_TO_TRY:
        try:
            log.info("Trying image generation with model: %s", model_name)
            response = client.models.generate_content(
                model=model_name,
                contents=f"Generate a detailed, high-quality image: {prompt}",
                config=types.GenerateContentConfig(
                    response_modalities=["IMAGE", "TEXT"],
                    image_config=types.ImageConfig(
                        aspect_ratio=aspect_ratio,
                    ),
                ),
            )

            # Extract image from response parts
            if response.candidates:
                for candidate in response.candidates:
                    if candidate.content and candidate.content.parts:
                        for part in candidate.content.parts:
                            if part.inline_data and part.inline_data.mime_type and part.inline_data.mime_type.startswith("image/"):
                                log.info("Image generated successfully with %s", model_name)
                                return part.inline_data.data

            log.warning("Model %s returned no image data, trying next...", model_name)
        except Exception as e:
            last_error = e
            log.warning("Model %s failed: %s, trying next...", model_name, e)

    raise RuntimeError(
        f"All image generation models failed. Last error: {last_error}"
    )


def _save_wave(filename: str, pcm_data: bytes, channels: int = 1,
               rate: int = 24000, sample_width: int = 2) -> None:
    """Save raw PCM data as a WAV file."""
    with wave.open(filename, "wb") as wf:
        wf.setnchannels(channels)
        wf.setsampwidth(sample_width)
        wf.setframerate(rate)
        wf.writeframes(pcm_data)


# ---------------------------------------------------------------------------
# Tool 1: Image Generation (Nano Banana / Gemini native)
# ---------------------------------------------------------------------------

@mcp.tool(
    name="gemini_generate_image",
    annotations={
        "title": "Generate Image with Gemini",
        "readOnlyHint": False,
        "destructiveHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
)
async def gemini_generate_image(
    prompt: str,
    output_path: Optional[str] = None,
    width: Optional[int] = None,
    height: Optional[int] = None,
    aspect_ratio: Optional[str] = None,
) -> str:
    """Generate an image from a text prompt using Gemini's native image generation.

    Creates an image based on the supplied description and saves it to disk.

    Args:
        prompt: Detailed description of the image to generate.
        output_path: Full file path for the output image. Defaults to
            ~/Desktop/friday-creations/image_<timestamp>.png
        width: Desired image width in pixels (used to infer aspect ratio).
        height: Desired image height in pixels (used to infer aspect ratio).
        aspect_ratio: Explicit aspect ratio like "1:1", "16:9", "9:16".
            Overrides width/height if provided.

    Returns:
        The absolute file path of the saved image, or an error message.
    """
    try:
        log.info("Generating image: %s", prompt[:80])
        Image = _get_pil_image()

        ar = aspect_ratio or _aspect_ratio_from_dims(width, height)
        image_bytes = await _generate_image(prompt, ar)

        out = _resolve_output_path(output_path, "image", "png")

        # Save the image bytes
        img = Image.open(io.BytesIO(image_bytes))
        img.save(out, "PNG")

        log.info("Image saved to %s", out)
        return f"Image saved to: {out}"
    except Exception as exc:
        log.error("Image generation failed: %s", exc)
        return f"Error generating image: {exc}"


# ---------------------------------------------------------------------------
# Tool 2: Text Generation
# ---------------------------------------------------------------------------

@mcp.tool(
    name="gemini_generate_text",
    annotations={
        "title": "Generate Text with Gemini",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
)
async def gemini_generate_text(
    prompt: str,
    model: Optional[str] = None,
    temperature: Optional[float] = 0.9,
    max_tokens: Optional[int] = None,
) -> str:
    """Generate text using a Gemini model for creative writing, brainstorming,
    or alternate perspectives.

    Args:
        prompt: The text prompt / instruction.
        model: Gemini model name (default: gemini-2.5-pro).
        temperature: Sampling temperature 0.0-2.0 (default: 0.9).
        max_tokens: Maximum output tokens (optional).

    Returns:
        The generated text, or an error message.
    """
    try:
        client = _get_client()
        types = _get_types()
        use_model = model or TEXT_MODEL
        log.info("Generating text with %s (temp=%.1f)", use_model, temperature)

        config_kwargs = {"temperature": temperature}
        if max_tokens:
            config_kwargs["max_output_tokens"] = max_tokens

        response = client.models.generate_content(
            model=use_model,
            contents=prompt,
            config=types.GenerateContentConfig(**config_kwargs),
        )
        return response.text
    except Exception as exc:
        log.error("Text generation failed: %s", exc)
        return f"Error generating text: {exc}"


# ---------------------------------------------------------------------------
# Tool 3: Image Description (Vision)
# ---------------------------------------------------------------------------

@mcp.tool(
    name="gemini_describe_image",
    annotations={
        "title": "Describe Image with Gemini Vision",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": True,
        "openWorldHint": True,
    },
)
async def gemini_describe_image(
    image_path: str,
    prompt: Optional[str] = "Describe this image in detail",
) -> str:
    """Analyze and describe an image file using Gemini's vision capabilities.

    Args:
        image_path: Absolute path to the image file on disk.
        prompt: Question or instruction about the image
            (default: "Describe this image in detail").

    Returns:
        Gemini's textual description / analysis, or an error message.
    """
    try:
        client = _get_client()
        types = _get_types()
        p = Path(image_path)
        if not p.exists():
            return f"Error: File not found — {image_path}"

        log.info("Describing image: %s", image_path)

        # Read image bytes and determine mime type
        with open(p, "rb") as f:
            image_bytes = f.read()

        ext = p.suffix.lower()
        mime_map = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                    ".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp"}
        mime_type = mime_map.get(ext, "image/png")

        response = client.models.generate_content(
            model=VISION_MODEL,
            contents=[
                prompt,
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            ],
        )
        return response.text
    except Exception as exc:
        log.error("Image description failed: %s", exc)
        return f"Error describing image: {exc}"


# ---------------------------------------------------------------------------
# Tool 4: Text-to-Speech
# ---------------------------------------------------------------------------

TTS_VOICES = [
    "Kore", "Charon", "Fenrir", "Aoede", "Puck",
    "Leda", "Orus", "Zephyr",
]

@mcp.tool(
    name="gemini_text_to_speech",
    annotations={
        "title": "Text to Speech with Gemini",
        "readOnlyHint": False,
        "destructiveHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
)
async def gemini_text_to_speech(
    text: str,
    output_path: Optional[str] = None,
    voice: Optional[str] = None,
) -> str:
    """Convert text to a speech audio file using Gemini TTS.

    Args:
        text: The text to speak.
        output_path: File path for the output WAV file. Defaults to
            ~/Desktop/friday-creations/speech_<timestamp>.wav
        voice: Voice name (e.g. Kore, Charon, Fenrir, Aoede, Puck, Leda, Orus, Zephyr).
            Defaults to Kore.

    Returns:
        The absolute file path of the saved audio, or an error message.
    """
    try:
        client = _get_client()
        types = _get_types()
        voice_name = voice or "Kore"
        log.info("Generating speech for %d chars with voice %s", len(text), voice_name)

        response = client.models.generate_content(
            model=TTS_MODEL,
            contents=f"Say the following text naturally: {text}",
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
                speech_config=types.SpeechConfig(
                    voice_config=types.VoiceConfig(
                        prebuilt_voice_config=types.PrebuiltVoiceConfig(
                            voice_name=voice_name,
                        )
                    )
                ),
            ),
        )

        out = _resolve_output_path(output_path, "speech", "wav")

        # Extract audio data from response
        audio_data = response.candidates[0].content.parts[0].inline_data.data
        _save_wave(out, audio_data, channels=1, rate=24000, sample_width=2)

        log.info("Speech saved to %s", out)
        return f"Audio saved to: {out}"
    except Exception as exc:
        log.error("TTS failed: %s", exc)
        return f"Error generating speech: {exc}"


# ---------------------------------------------------------------------------
# Tool 5: Creative Remix
# ---------------------------------------------------------------------------

@mcp.tool(
    name="gemini_creative_remix",
    annotations={
        "title": "Creative Image Remix",
        "readOnlyHint": False,
        "destructiveHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
)
async def gemini_creative_remix(
    image_path: str,
    style_prompt: str,
    output_path: Optional[str] = None,
) -> str:
    """Take an existing image and create a creative variation or remix.

    Uses Gemini's multimodal capabilities to understand the source image,
    then generates a new image inspired by the source and the style prompt.

    Args:
        image_path: Absolute path to the source image.
        style_prompt: Description of the desired creative style / variation
            (e.g. "oil painting", "cyberpunk neon", "watercolor sketch").
        output_path: File path for the output image. Defaults to
            ~/Desktop/friday-creations/remix_<timestamp>.png

    Returns:
        The file path of the remixed image, or an error message.
    """
    try:
        client = _get_client()
        types = _get_types()
        Image = _get_pil_image()
        p = Path(image_path)
        if not p.exists():
            return f"Error: File not found — {image_path}"

        log.info("Remixing image: %s with style: %s", image_path, style_prompt[:60])

        # Read source image
        with open(p, "rb") as f:
            image_bytes = f.read()

        ext = p.suffix.lower()
        mime_map = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
                    ".gif": "image/gif", ".webp": "image/webp"}
        mime_type = mime_map.get(ext, "image/png")

        # Step 1: Describe the source image
        desc_response = client.models.generate_content(
            model=VISION_MODEL,
            contents=[
                "Describe this image in vivid detail suitable for recreating it in a new artistic style. "
                "Focus on composition, subjects, colors, lighting, and mood.",
                types.Part.from_bytes(data=image_bytes, mime_type=mime_type),
            ],
        )
        description = desc_response.text

        # Step 2: Generate a new image in the requested style
        remix_prompt = (
            f"Create an image in the following style: {style_prompt}. "
            f"The image should depict: {description}"
        )

        remix_bytes = await _generate_image(remix_prompt)

        out = _resolve_output_path(output_path, "remix", "png")
        img = Image.open(io.BytesIO(remix_bytes))
        img.save(out, "PNG")

        log.info("Remix saved to %s", out)
        return f"Remix saved to: {out}"
    except Exception as exc:
        log.error("Creative remix failed: %s", exc)
        return f"Error creating remix: {exc}"


# ---------------------------------------------------------------------------
# Tool 6: Generative Code Art
# ---------------------------------------------------------------------------

@mcp.tool(
    name="gemini_generate_code_art",
    annotations={
        "title": "Generate Code Art",
        "readOnlyHint": True,
        "destructiveHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
)
async def gemini_generate_code_art(
    description: str,
    style: Optional[str] = None,
) -> str:
    """Generate p5.js or HTML/CSS generative art code from a description.

    Returns a complete, self-contained HTML file that can be opened in a
    browser to view the art.

    Args:
        description: What the generative art should look like / do.
        style: Optional aesthetic style, e.g. "vaporwave", "minimalist",
            "glitch", "bauhaus", "pixel", "watercolor".

    Returns:
        A complete HTML document containing the generative art code.
    """
    try:
        client = _get_client()
        types = _get_types()
        style_clause = f" in a {style} aesthetic style" if style else ""
        code_prompt = (
            f"Write a complete, self-contained HTML file with embedded JavaScript "
            f"that creates generative art{style_clause}. Use p5.js (loaded from CDN) "
            f"for the canvas. The art should depict: {description}\n\n"
            f"Requirements:\n"
            f"- Single HTML file, no external dependencies except p5.js CDN\n"
            f"- Responsive canvas that fills the browser window\n"
            f"- Animated or interactive where appropriate\n"
            f"- Visually striking and creative\n"
            f"- Include brief comments explaining the technique\n\n"
            f"Return ONLY the HTML code, no explanation."
        )

        log.info("Generating code art: %s", description[:80])
        response = client.models.generate_content(
            model=TEXT_MODEL,
            contents=code_prompt,
            config=types.GenerateContentConfig(temperature=1.0),
        )
        code = response.text

        # Strip markdown fences if present
        if code.startswith("```"):
            lines = code.split("\n")
            if lines[0].startswith("```"):
                lines = lines[1:]
            if lines and lines[-1].strip() == "```":
                lines = lines[:-1]
            code = "\n".join(lines)

        return code
    except Exception as exc:
        log.error("Code art generation failed: %s", exc)
        return f"Error generating code art: {exc}"


# ---------------------------------------------------------------------------
# Tool 7: Video Generation (Veo)
# ---------------------------------------------------------------------------

@mcp.tool(
    name="gemini_generate_video",
    annotations={
        "title": "Generate Video with Veo",
        "readOnlyHint": False,
        "destructiveHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
)
async def gemini_generate_video(
    prompt: str,
    output_path: Optional[str] = None,
    duration_seconds: Optional[int] = 8,
    model: Optional[str] = None,
) -> str:
    """Generate a video from a text prompt using Google's Veo model.

    Creates a short video based on the description and saves it to disk.
    Video generation is asynchronous and may take 1-3 minutes.

    Args:
        prompt: Detailed description of the video to generate.
        output_path: Full file path for the output video. Defaults to
            ~/Desktop/friday-creations/video_<timestamp>.mp4
        duration_seconds: Desired video duration in seconds (default: 8).
        model: Veo model name. Defaults to veo-3.1-generate-preview.
            Also available: veo-3.1-fast-generate-preview,
            veo-3.1-lite-generate-preview (fastest).

    Returns:
        The absolute file path of the saved video, or an error message.
    """
    try:
        client = _get_client()
        types = _get_types()
        use_model = model or VIDEO_MODEL
        log.info("Generating video with %s: %s", use_model, prompt[:80])

        # Start the async video generation operation
        operation = client.models.generate_videos(
            model=use_model,
            prompt=prompt,
            config=types.GenerateVideosConfig(
                number_of_videos=1,
                duration_seconds=duration_seconds,
            ),
        )

        # Poll until complete (video gen can take 1-3 minutes)
        poll_count = 0
        max_polls = 60  # 5 minutes max
        while not operation.done:
            poll_count += 1
            if poll_count > max_polls:
                return "Error: Video generation timed out after 5 minutes."
            log.info("Video generation in progress... (poll %d)", poll_count)
            time.sleep(5)
            operation = client.operations.get(operation)

        out = _resolve_output_path(output_path, "video", "mp4")

        # Extract and save the video
        if operation.response and operation.response.generated_videos:
            video = operation.response.generated_videos[0]
            # The video data may be in video.video or need to be downloaded
            if hasattr(video, 'video') and video.video:
                video_bytes = video.video
                if isinstance(video_bytes, str):
                    # Base64 encoded
                    video_bytes = base64.b64decode(video_bytes)
                with open(out, "wb") as f:
                    f.write(video_bytes)
            elif hasattr(video, 'uri') and video.uri:
                # Download from URI
                import httpx
                async with httpx.AsyncClient(timeout=120.0) as http_client:
                    resp = await http_client.get(video.uri)
                    resp.raise_for_status()
                    with open(out, "wb") as f:
                        f.write(resp.content)
            else:
                return f"Error: Video generated but no data found in response. Response: {operation.response}"
        else:
            return f"Error: Video generation completed but no video in response."

        log.info("Video saved to %s", out)
        return f"Video saved to: {out}"
    except Exception as exc:
        log.error("Video generation failed: %s", exc)
        return f"Error generating video: {exc}"


# ---------------------------------------------------------------------------
# Tool 8: Music Generation (Lyria)
# ---------------------------------------------------------------------------

@mcp.tool(
    name="gemini_generate_music",
    annotations={
        "title": "Generate Music with Lyria",
        "readOnlyHint": False,
        "destructiveHint": False,
        "idempotentHint": False,
        "openWorldHint": True,
    },
)
async def gemini_generate_music(
    prompt: str,
    output_path: Optional[str] = None,
    clip: bool = False,
) -> str:
    """Generate music from a text prompt using Google's Lyria model.

    Creates a music track and saves it to disk.

    Args:
        prompt: Description of the music to generate (genre, mood, instruments,
            tempo, etc.). Example: "An upbeat electronic dance track with
            synthesizers and a driving beat, 120 BPM".
        output_path: File path for the output audio file. Defaults to
            ~/Desktop/friday-creations/music_<timestamp>.wav
        clip: If True, generates a short 30-second clip using lyria-3-clip-preview.
            If False (default), uses lyria-3-pro-preview for longer tracks.

    Returns:
        The absolute file path of the saved music, or an error message.
    """
    try:
        client = _get_client()
        types = _get_types()
        use_model = MUSIC_CLIP_MODEL if clip else MUSIC_MODEL
        log.info("Generating music with %s: %s", use_model, prompt[:80])

        response = client.models.generate_content(
            model=use_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_modalities=["AUDIO"],
            ),
        )

        out = _resolve_output_path(output_path, "music", "wav")

        # Extract audio data from response
        audio_data = None
        if response.candidates:
            for candidate in response.candidates:
                if candidate.content and candidate.content.parts:
                    for part in candidate.content.parts:
                        if part.inline_data and part.inline_data.data:
                            audio_data = part.inline_data.data
                            break
                if audio_data:
                    break

        if not audio_data:
            return "Error: Music generation returned no audio data."

        # Save as WAV — Lyria returns 48kHz stereo audio
        _save_wave(out, audio_data, channels=2, rate=48000, sample_width=2)

        log.info("Music saved to %s", out)
        return f"Music saved to: {out}"
    except Exception as exc:
        log.error("Music generation failed: %s", exc)
        return f"Error generating music: {exc}"


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    log.info("Starting Gemini MCP server…")
    mcp.run()
