# Building the mock-interview avatars

The two interviewers (`public/interview/avatars/*-v1.glb`) are generated, not
hand-made, so they can be rebuilt or new ones added the same way. All free,
all CC0/MIT assets, no Blender UI needed.

1. Portable Blender 4.5 LTS in a SHORT path (Windows' 260-character limit
   breaks MPFB's install from a long path), with a `portable/` folder next to
   `blender.exe` so settings stay local.
2. Install MPFB 2.0.17 (extensions.blender.org) and TalkingHead's
   `blender/MPFB/talkinghead-addon.py`:
   `bpy.ops.extensions.package_install_files(filepath=..., repo="user_default", enable_on_install=True)`,
   `bpy.ops.preferences.addon_install(...)` + `addon_enable` + `wm.save_userpref`.
3. Unzip the CC0 packs into MPFB's user data
   (`portable/extensions/.user/user_default/mpfb/data`): makehuman_system_assets,
   skins01, skins02, suits01, shirts01, visemes02, faceunits01
   (files2.makehumancommunity.org; the server is slow per connection — ranged
   parallel downloads help).
4. Install TalkingHead's rig as a library rig: `talkinghead.mpfbskel` →
   `data/rigs/talkinghead.json` with `"identifying_bones": ["LeftToe_End"]`,
   `talkinghead.mhw` → `data/rigs/weights.talkinghead.json`.
5. `blender.exe -b --python build_avatar.py -- emma emma-raw.glb` (and `daniel`).
   The script builds the character (phenotype, skin, GAMEENGINE materials,
   `custom.talkinghead` rig, no subdivision), makes MPFB's export copy with
   Meta visemes + ARKit face units, bakes masks, fixes bone rolls with the
   TalkingHead add-on, sets realistic roughness (MakeHuman's glossy hair turns
   white in glTF otherwise), cuts out hair, brows, lashes and the eye's cornea
   (MASK), and exports GLB.
6. `npx @gltf-transform/cli optimize in.glb out.glb --compress meshopt --texture-compress webp --texture-size 1024 --simplify false`
   (~17 MB → ~1.6 MB; keep `--simplify false` or the morph targets break).
