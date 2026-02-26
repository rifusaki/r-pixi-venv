# R Pixi Venv (r-pixi-venv)

A VS Code extension to use Pixi-managed virtual environments on R and Quarto. There is support for Pixi-managed R on RStudio/Positron but this is for those who would rather stay in VS Code. I'm not sure about Quarto, though.

## Features

- **Automatic environment configuration**: The extension modifies your VS Code workspace settings to point R and Quarto language services to the binaries inside your `.pixi/envs/default` directory. This assumes you have either a `pixi.toml` or `pyproject.toml` file.
- **Manual Setup Command**: You can manually trigger the configuration via the command palette: `Setup R and Quarto from Pixi`.
- **Install Dependencies**: The `Install R and Quarto to Pixi` command allows you to add `r-base`, `r-languageserver`, and `quarto` to your environment and run the setup.


### Settings Configured

Once activated, the following settings are automatically injected into your `.vscode/settings.json`:

- `r.rpath.*`: Points to Pixi R executable
- `r.rterm.*`: Points to Pixi R terminal
- `quarto.path`: Points to Pixi Quarto executable

## Requirements

- [Pixi](https://pixi.sh/) must be installed on your system.
- R and Quarto extensions are highly recommended.


## Extension Commands

- `r-pixi-venv.setup`: Setup R and Quarto from Pixi.
- `r-pixi-venv.installDependencies`: Install R and Quarto to Pixi.
- `r-pixi-venv.renderQuarto`: Pixi: Render Quarto (uses default format, has a play button in the editor navigation bar).
- `r-pixi-venv.renderQuartoFormat`: Pixi: Render Quarto (Select Format) (choose between html, pdf, typst, docx, revealjs, etc.).
- `r-pixi-venv.previewQuarto`: Pixi: Preview Quarto (spawns a live background preview server, has an open-preview button in the editor navigation bar).

## Limitations

- Currently, this extension assumes the primary environment is named `default` or uses the first environment returned by `pixi info`. Multi-environment selection is not yet supported.