# Native Linux versioning

The independently maintained Linux client has its own SemVer release line.
Its public compatibility surface comprises vault formats, CLI behavior and the
native desktop workflows. Both Linux architectures use the same client version.

`src/RonSijm.Slopsidian.Linux/RonSijm.Slopsidian.Linux.csproj` contains the single
`Version` property. The current development version is `0.2.0-preview.1`.

- About and `slopsidian-native --version` read generated assembly metadata.
- The packaging script evaluates the same MSBuild property for artifact names.
- Linux release tags follow `linux-v<version>`, for example
  `linux-v0.2.0-preview.1`. A mismatching tag makes packaging fail before staging.
- A native tag runs the Linux artifact workflow. Release publication is a
  separate maintainer action.

Prereleases identify development/review builds. Increment the prerelease number
for a subsequent distributed preview; use a new patch/minor version for fixes
or added behavior after a stable release. The 0.x line remains under development.
A published version identifies immutable release contents.

The archive keeps the SemVer string, for example
`Slopsidian-Native-0.2.0-preview.1-linux-x64.tar.gz`. Debian uses
`0.2.0~preview.1`, so a preview sorts before `0.2.0`. Build metadata is excluded
from Debian version ordering; architecture remains a separate package field.

References:

- https://semver.org/
- https://www.debian.org/doc/debian-policy/ch-controlfields.html#version
- https://learn.microsoft.com/en-us/dotnet/standard/assembly/set-attributes-project-file
