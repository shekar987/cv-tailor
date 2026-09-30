# Mock-interview avatars

`emma-v2.glb` (Emma Clarke) is Microsoft Rocketbox `Business_Female_04` and
`daniel-v2.glb` (Daniel Okafor) is `Business_Male_05`, from
https://github.com/microsoft/Microsoft-Rocketbox (the "facial" versions, with
ARKit and Oculus-viseme blend shapes by Fang Ma, Goldsmiths). They were
converted headless in Blender 4.5 LTS for TalkingHead — skeleton renamed and
re-oriented to TalkingHead's Mixamo-style rig, blend shapes renamed with
TalkingHead's `rename-rocketbox-shapekeys.py` map, specular maps turned into
roughness maps — and compressed with glTF-Transform (meshopt + WebP). Rebuild
with `scripts/avatars/README.md`.

The avatars are used under the MIT License:

MIT License

Copyright (c) 2020 Microsoft

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
