#!/bin/sh
# raw.glb -> web GLB: the face's colour map keeps 2048 px (it is a quarter of
# the atlas, and the camera is at head-and-shoulders); normal, roughness,
# clothing and cut-out maps drop to 1024 px; meshopt + WebP. Never simplify
# (breaks the morph targets), never flatten/join (drops the "Armature" node
# TalkingHead looks for).
set -e
IN="$1"; OUT="$2"; TMP="${OUT%.glb}-tmp.glb"
npx -y @gltf-transform/cli@4 resize "$IN" "$TMP" --pattern "*_normal*" --width 1024 --height 1024
npx -y @gltf-transform/cli@4 resize "$TMP" "$TMP" --pattern "*_roughness*" --width 1024 --height 1024
npx -y @gltf-transform/cli@4 resize "$TMP" "$TMP" --pattern "*body_color*" --width 1024 --height 1024
npx -y @gltf-transform/cli@4 resize "$TMP" "$TMP" --pattern "*opacity*" --width 1024 --height 1024
npx -y @gltf-transform/cli@4 optimize "$TMP" "$OUT" --compress meshopt --texture-compress webp --texture-size 2048 --simplify false --flatten false --join false
rm -f "$TMP"
