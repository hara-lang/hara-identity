# Public visual-language boundary

The Identity landing surface uses the same public visual layer as
`www.hara-lang.org` and Hara Packages. The canonical source is
`hara-lang/visual-language`; the exact vendored v1.0.0 files and Git blob IDs
are recorded in `site/vendor/visual-language/SOURCE.md`.

This layer owns only public presentation:

- the Hara mark and public navigation shell;
- frost and graphite surfaces with one functional signal blue;
- shared typography, focus-visible behaviour, theme preference, and reduced motion;
- responsive spacing for the public landing page.

Identity remains the authority for OAuth, sessions, global logout, exact origin
allowlists, handoff, and the signed package trust policy. None of those mechanics
is represented by colour or moved into the visual package. Editor syntax,
diagnostic, and workbench palettes remain outside this public surface.

When the canonical visual-language release changes, update the vendored files,
refresh the blob pins in `SOURCE.md`, and run `npm test` before publication.
