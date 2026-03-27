# Test file 1
Some text

## Report data

**Chat node** — an agent conversation terminal embedded in the canvas:
1. file1
2. file2

$\frac{1}{\alpha}$

[some-external-link](http://xlydian.com)

---
![my-image](image.svg)
---

```python
def foo():
    print("")
```
Test it !!!

# Development Setup Guide

This project uses Poetry dependency groups to manage production vs local development dependencies.

## Quick Start

### Production Mode (Published Packages)
Use this when running production code or when you don't need to modify Qubx/QuantKit:

```bash
poetry install
```

This installs:
- `Qubx >= 0.7.30` from PyPI/gtradex
- `QuantKit >= 1.2.0` from PyPI/gtradex

### Research/Development Mode (Local Paths)
Use this when doing research or actively developing Qubx/QuantKit:

```bash
poetry install --with local
```

This installs local editable versions:
- `Qubx` from `../../devs/Qubx`
- `QuantKit` from `../../devs/quantkit`

Changes in those directories are immediately reflected without reinstalling.

## Switching Between Modes

### Switch to Research Mode
```bash
poetry install --with local
```

### Switch Back to Production Mode
```bash
poetry install --sync  # Removes local group deps
# or
poetry install --without local
```

## Verification

Check which version is active:
```bash
poetry run python -c "import qubx; print(qubx.__file__)"
poetry run python -c "import quantkit; print(quantkit.__file__)"
```

**Production mode** shows: `/home/quant0/projects/xmetals/.venv/lib/python3.11/site-packages/...`
**Research mode** shows: `/home/quant0/devs/Qubx/src/qubx/...` or `/home/quant0/devs/quantkit/src/quantkit/...`

## Notes

- The `local` group is marked as `optional = true` - it won't affect production deployments
- Both dependency versions coexist in `poetry.lock`
- No need to manually edit `pyproject.toml` anymore
- CI/CD pipelines should use `poetry install` (production mode by default)
