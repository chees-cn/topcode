# TopCode

Next-generation CLI agent framework — zero model lock-in, state-manifold context management, and a full-screen terminal UI.

TopCode does not use native tool calls. The model interacts with your environment strictly through Markdown-fenced JSON commands, which are intercepted mid-stream, executed, and compressed back into `[SYSTEM ASSERTION]` state assertions — keeping context flat even across long sessions.

## Install

```bash
npm install -g topcode
```

Requires Node.js ≥ 18.

## Quick start

```bash
cd your-project
topcode
```

On first run, an interactive setup wizard asks for your API endpoint, key, and model, and saves them to `~/.topcode/config.json` (user-level, mode 0600). Any OpenAI-compatible endpoint works (OpenAI, DeepSeek, local vLLM/Ollama, …).

You can also configure via environment variables:

```bash
export TOPCODE_BASE_URL=https://api.openai.com/v1
export TOPCODE_API_KEY=sk-...
export TOPCODE_MODEL=gpt-4o
```

Or per-project via `topcode.config.json` in the project root (highest priority):

```json
{
  "provider": {
    "base_url": "https://api.deepseek.com",
    "api_key": "sk-...",
    "models": { "deep": "deepseek-chat", "quick": "deepseek-chat" },
    "category": "openai"
  }
}
```

Configuration precedence: project `topcode.config.json` > user `~/.topcode/config.json` > environment variables > defaults.

## Usage

| Command | Description |
| --- | --- |
| `topcode` | Launch the interactive TUI |
| `topcode -p "fix the failing test"` | Non-interactive single prompt (CI / pipes) |
| `topcode --no-tui` | Legacy line-based REPL |

### TUI keys

| Key | Action |
| --- | --- |
| `Enter` | Send message / run highlighted slash command |
| `↑` / `↓` | Input history (or navigate the slash-command menu) |
| `Esc` | Cancel the current generation / close menu or overlay |
| `Ctrl+P` | Session history picker (last 3 archived sessions) |
| `Ctrl+C` | Cancel generation (busy) / exit (idle) |

Typing `/` opens the slash-command menu with live filtering.

### Slash commands

| Command | Description |
| --- | --- |
| `/help` | Show all commands and keys |
| `/new` | Archive the current session and start a new one |
| `/clear` | Clear the transcript view |
| `/model [name]` | Set the model (all lanes), persisted to user config |
| `/language [en\|zh]` | Switch UI language (default English) |
| `/status` | Show version, model, endpoint, session info |
| `/version` | Show version |
| `/resume` | Resume a recent session (same as `Ctrl+P`) |
| `/export [file]` | Export the transcript to a Markdown file |
| `/init` | Scaffold `TOPCODE.md` project memory (injected into the context projection) |
| `/exit` `/quit` | Exit TopCode |

Only the last **3** archived sessions are kept per project (`topcode-sessions.json`, git-ignored) — long-term memory lives in the state manifold, not in chat tapes.

### Available actions (model → environment)

`read_file` · `modify_file` · `run_terminal` · `query_ast_graph`

High-risk modifications are snapshot-protected (git-based rollback), and action results are compressed into state assertions instead of raw stack traces.

## How it works

1. **Stream interception** — LLM output is parsed mid-stream by an incremental state machine; a closed ````json` fence aborts generation immediately.
2. **State manifold** — local JSON knowledge graph of your project; each turn projects only the minimal sufficient context.
3. **Context pruning** — action results never enter the conversation raw; they are distilled into one-line assertions.

## Links

- Repository: <https://github.com/chees-cn/topcode>
- Issues: <https://github.com/chees-cn/topcode/issues>

## License

[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.html)
