# Gemini MCP Server — Agent Friday's Creative Capabilities

A [FastMCP](https://github.com/jlowin/fastmcp) server that gives Agent Friday creative capabilities via Google's Gemini API. Part of the [Asimov's Mind](https://github.com/FutureSpeakAI/asimovs-mind) ecosystem.

See also: [claude-gemini-bridge](https://github.com/FutureSpeakAI/claude-gemini-bridge) for bridging Gemini Live voice to Claude Code.

## Tools

| Tool | Description |
|------|-------------|
| `gemini_generate_image` | Generate images from text prompts (Nano Banana Pro, Flash fallback) |
| `gemini_generate_text` | Creative text generation (brainstorming, writing, etc.) |
| `gemini_describe_image` | Analyze/describe images using Gemini Vision |
| `gemini_text_to_speech` | Convert text to speech audio (8 voices) |
| `gemini_creative_remix` | Remix an existing image in a new style |
| `gemini_generate_code_art` | Generate p5.js / HTML generative art code |
| `gemini_generate_video` | Generate video with Veo (async, 1-3 min) |
| `gemini_generate_music` | Generate music with Lyria (full tracks or 30s clips) |

## Setup

```bash
# From the repo root:
pip install -r mcp-servers/gemini-mcp/requirements.txt

# Or use the repo-wide requirements.txt:
pip install -r requirements.txt
```

Output files go to `~/Desktop/friday-creations/` by default. Override with the `FRIDAY_CREATIONS_DIR` environment variable.

## Running Standalone

```bash
export GEMINI_API_KEY=your-key-here
python mcp-servers/gemini-mcp/server.py
```

## Claude Code MCP Configuration

```bash
claude mcp add friday-gemini -- python mcp-servers/gemini-mcp/server.py
```

Set the `GEMINI_API_KEY` environment variable before launching Claude Code.

## Claude Desktop MCP Configuration

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "friday-gemini": {
      "command": "python",
      "args": ["path/to/asimovs-mind/mcp-servers/gemini-mcp/server.py"],
      "env": {
        "GEMINI_API_KEY": "YOUR_GEMINI_API_KEY_HERE"
      }
    }
  }
}
```
