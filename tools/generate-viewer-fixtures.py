"""Deterministic AVIF and seekable WebM fixtures for the viewer scenarios.

Run once with the generators installed outside the repo dependency tree:
  pip install --target .runtime\\fixture-tools pillow-avif-plugin av
  python tools\\generate-viewer-fixtures.py
Outputs are committed data (tests\\fixtures\\viewers) with sha256 provenance in
manifest.json; the scenarios never need an encoder at runtime. Generator licences
(libavif/libaom BSD-2, PyAV BSD-3 with bundled FFmpeg/libvpx) do not apply to the
generated pixel data, which is synthetic solid colour.
"""
import hashlib, json, os, sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".runtime", "fixture-tools"))
import av, pillow_avif  # noqa: F401
from PIL import Image

out = os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "viewers")
os.makedirs(out, exist_ok=True)

image = Image.new("RGB", (32, 16), (220, 30, 30))
image.paste((30, 30, 220), (16, 0, 32, 16))
image.save(os.path.join(out, "Split.avif"), quality=100, speed=6, subsampling="4:4:4")

container = av.open(os.path.join(out, "Seek.webm"), "w", format="webm", options={"fflags": "+bitexact", "flags": "+bitexact"})
stream = container.add_stream("libvpx-vp9", rate=10)
stream.codec_context.flags |= av.codec.context.Flags.bitexact
stream.width, stream.height, stream.pix_fmt = 64, 48, "yuv420p"
stream.options = {"g": "5", "deadline": "good", "cpu-used": "4", "threads": "1"}
for index in range(40):
    colour = (220, 30, 30) if index < 20 else (30, 30, 220)
    frame = av.VideoFrame.from_image(Image.new("RGB", (64, 48), colour))
    frame.pts = index
    for packet in stream.encode(frame):
        container.mux(packet)
for packet in stream.encode():
    container.mux(packet)
container.close()

manifest = {}
for name in sorted(os.listdir(out)):
    if name == "manifest.json":
        continue
    data = open(os.path.join(out, name), "rb").read()
    manifest[name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
manifest["_provenance"] = "Synthetic: Split.avif 32x16 red|blue halves (AV1 still, libavif via pillow-avif-plugin 1.6.0); Seek.webm 64x48 VP9 4s, 10fps, red for t<2s then blue, keyframe every 5 frames, with Cues (PyAV 19.0.2 / libvpx)."
open(os.path.join(out, "manifest.json"), "w").write(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(manifest, indent=2))
