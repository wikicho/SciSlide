# AI assistance

The Electron desktop app can use a compatible installed **Codex CLI**, **Claude Code** or **Gemini CLI** to draft editable slides. The web editor cannot launch local programs. A provider's desktop chatbot application alone is insufficient; SciSlide needs its command-line interface.

## Connect a provider

1. Install the provider CLI and sign in through your terminal.
2. Open **AI draft** in SciSlide.
3. Choose **Refresh AI connections**, then select an available provider.
4. If a connection is unavailable, read the displayed reason. Detection verifies executables and required controls, rather than proving successful authentication.

SciSlide 0.6.2 accepts these reviewed adapter configurations:

| Provider    | Required compatibility                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Codex CLI   | Version **0.160.x**, advertising the required isolated-configuration, read-only and structured-output controls.                                        |
| Claude Code | Must advertise every required safe-mode, restricted, tool-disabling and structured-output flag. An installed version may therefore remain unavailable. |
| Gemini CLI  | Version **0.62.x** with the reviewed controls; system-managed settings/defaults must allow verification of the content-only configuration.             |

These are the app's adapter constraints, rather than a recommendation to install the latest provider release. Other versions require compatibility review before the app enables them.

## Generate and insert a draft

Enter a topic and choose **1–12 slides**, then click **Generate draft**. You may optionally include the current slide's visible text, equations and speaker notes; the context preview shows exactly what will be included. Figures, video bytes, file paths and local TeX configuration are excluded.

Review the resulting titles, bullet points, equations and notes. Click **Insert draft slides** to insert the slides after the current one. They become ordinary editable objects; Undo restores the preceding deck. The draft's overall title labels its preview and does not rename the presentation.

The app checks response structure, MathJax syntax and equation size before insertion. Invalid output is rejected. If the source slide changes, generate a fresh draft. Review scientific claims, citations and mathematical reasoning before presenting the result.

## Provider behavior and limits

Requests use the provider's existing account and network access. Its usage limits, data policies and any account charges apply. SciSlide does not provide an API-key settings page or store API keys.

The desktop host uses fixed provider commands, sends prompts through stdin and runs each request in a private temporary workspace. Codex uses read-only enforcement and restricted integrations; compatible Claude/Gemini modes disable content-generation tools. The app reuses supported existing provider authentication without reading credential contents. User customizations and organization policies can make a connection unavailable.

Only **one generation** runs at a time. Requests time out after **three minutes**, and output is bounded. **Cancel** or closing the dialog terminates the job. Provider errors should also be checked in the terminal using the same installed CLI/account.

Image generation, file/repository access, web research, full-deck replacement, streaming chat and direct API-key setup are not implemented. See [Architecture and roadmap](Architecture-and-Roadmap) for future work, or [Troubleshooting](Troubleshooting) for connection problems.
