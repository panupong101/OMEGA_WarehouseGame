# OMEGA Warehouse Game

[![CI](https://github.com/Woojae66/OMEGA_WarehouseGame/actions/workflows/ci.yml/badge.svg)](https://github.com/Woojae66/OMEGA_WarehouseGame/actions/workflows/ci.yml)
[![Deploy](https://github.com/Woojae66/OMEGA_WarehouseGame/actions/workflows/deploy.yml/badge.svg)](https://github.com/Woojae66/OMEGA_WarehouseGame/actions/workflows/deploy.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> Interactive 2D/3D warehouse layout planner and storage optimization tool for the AXL x ALP Thailand Project.

## Live Demo

[Play Now](https://Woojae66.github.io/OMEGA_WarehouseGame/)

## Features

- **2D Layout View** — Top-down warehouse floor plan with drag-and-drop
- **3D Isometric View** — Real-time 3D visualization with bundle stacking
- **5 Layout Strategies** — Type Split, Compact, FIFO, Quick Access, Project Cluster
- **Space Analytics** — Utilization heatmap and footprint calculations
- **Truck Loading** — Automated trip planning with deck optimization
- **PDF Export** — Full A3 landscape reports with 4K screenshots

## Quick Start

```bash
# Clone the repo
git clone https://github.com/Woojae66/OMEGA_WarehouseGame.git
cd OMEGA_WarehouseGame

# Open in browser
open src/index.html
```

No build tools required — it's a single self-contained HTML file.

## Project Structure

```
OMEGA_WarehouseGame/
├── .github/
│   ├── workflows/
│   │   ├── ci.yml              # CI pipeline (lint + validate)
│   │   └── deploy.yml          # GitHub Pages deployment
│   └── PULL_REQUEST_TEMPLATE.md
├── src/
│   └── index.html              # Main application (single-file)
├── docs/                       # Documentation
├── tests/                      # Test files
├── .editorconfig               # Editor settings
├── .gitignore                  # Git ignore rules
├── CONTRIBUTING.md             # How to contribute
├── LICENSE                     # MIT License
└── README.md                   # This file
```

## Branch Strategy

| Branch | Purpose | Auto-Deploy |
|--------|---------|-------------|
| `main` | Production-ready code | Yes (GitHub Pages) |
| `dev`  | Active development | No |

## Tech Stack

| Component | Technology |
|-----------|-----------|
| Rendering | HTML5 Canvas |
| Styling | CSS3 (inline) |
| Logic | Vanilla JavaScript |
| PDF Export | jsPDF (CDN) |
| CI/CD | GitHub Actions |
| Hosting | GitHub Pages |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License — see [LICENSE](LICENSE) for details.

## See Also

- [GitHub Repository](https://github.com/Woojae66/OMEGA_WarehouseGame)
- [Live Demo](https://Woojae66.github.io/OMEGA_WarehouseGame/)

---

Built with care for the AXL x ALP Thailand Project.
