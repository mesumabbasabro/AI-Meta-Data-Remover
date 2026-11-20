# AI Metadata Remover

A free, browser-only JPEG, PNG, and WebP metadata cleaner. No AI service, API key, database, or file upload server required.

## Run it

1. Extract the ZIP.
2. Open `index.html` in Chrome, Edge or Firefox.
3. Choose a JPEG, PNG or WebP file, view the inspection, click **Remove metadata**, then download the verified result.

For a local web server (optional), open a terminal in this folder and run `python -m http.server 8000`, then visit `http://localhost:8000`.

## How it works

- JPEG: removes most APP metadata segments (including EXIF/XMP, APP11 C2PA, IPTC and comments); retains JFIF APP0, ICC profiles in APP2 and Adobe color information in APP14.
- PNG: removes ancillary metadata chunks not on an explicit display/functionality allowlist (including text, eXIf, and caBX). Retains display and animation chunks and color information.
- WebP: removes non-image metadata chunks (including EXIF/XMP) and clears EXIF/XMP flags in VP8X; retains image/animation chunks and ICC color profile.
- Rescans the output before exposing its download link.

## Important limitations

This tool **does not remove invisible pixel-level watermarking** or guarantee an image won't be recognized as AI-generated. Color profiles are deliberately preserved. Some metadata may be encoded within preserved structures. PNG CRCs are not independently verified. Complex or malformed images need further validation, and this code is not a full forensic metadata analyzer.

For launch-quality use, have a developer test a diverse image corpus (AI generators, camera JPEGs, animated PNG/WebP, ICC profiles, corruption handling and image rendering). Add automated tests and accessibility/security review. Do not advertise total metadata elimination or undetectability.

## Hosting

Upload these 3 static files to any static host such as Cloudflare Pages. You do not need an AI API or backend for this website.

## Commercialization

The core processing has no third-party runtime dependencies. Site copy, privacy policy, analytics, and ads should be finalized before public launch. Don't enable ads until you have the appropriate publisher approval and privacy disclosures.
