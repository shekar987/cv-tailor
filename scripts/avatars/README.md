# Building the mock-interview avatars

The two interviewers (`public/interview/avatars/*-v2.glb`) are Microsoft
Rocketbox characters (MIT) converted for TalkingHead with no Blender UI and no
Mixamo upload, so they can be rebuilt, or another Rocketbox face added, the
same way: Emma is `Business_Female_04`, Daniel `Business_Male_05`.

1. Portable Blender 4.5 LTS in a SHORT path (e.g. `C:\Users\<you>\jhbl`), with
   a `portable/` folder next to `blender.exe` so settings stay local.
2. Install TalkingHead's add-on (`blender/MPFB/talkinghead-addon.py` in
   github.com/met4citizen/TalkingHead): `bpy.ops.preferences.addon_install(...)`
   + `addon_enable` + `wm.save_userpref`. The script uses its `fix_bone_axes`.
3. Put TalkingHead's `blender/rename-rocketbox-shapekeys.py` next to
   `build_rocketbox.py` (the script reads its shape-key map).
4. From github.com/microsoft/Microsoft-Rocketbox, `Assets/Avatars/Professions/<Name>/`:
   `Export/<Name>_facial.fbx` and every `Textures/*.tga`, keeping the
   `Export/` + `Textures/` layout (raw.githubusercontent.com serves them; the
   `media.githubusercontent.com` LFS URL answers with empty files).
5. `blender.exe -b --python build_rocketbox.py -- <Name>_facial.fbx <name>-raw.glb a none`
   - bones renamed to Mixamo's names; clavicles moved under Spine2, thighs
     under Hips;
   - bone frames set to the ones TalkingHead's poses were made on: the torso
     copies the reference rig's (Biped's head bone points at the face — the
     head pose then tipped the face to the ceiling — and its Spine2 leans back,
     which hunched the chest), limbs point at their child joint, eyes up with
     Z forward, rolls from the add-on;
   - shape keys renamed to TalkingHead's ARKit + Oculus names, the rest
     dropped (68 kept, 15 visemes);
   - the specular maps become roughness maps: glTF reads a specular texture's
     ALPHA channel and these maps have none, so everything rendered at full
     specular — pale, plastic skin;
   - `none` keeps the character's real size (the camera stands a fixed number
     of metres away, so a scaled-up figure fills more of the frame).
6. `sh pack.sh <name>-raw.glb <name>-v2.glb` (~27 MB → ~0.8 MB): the face's
   colour map stays 2048 px, the others drop to 1024 px, meshopt + WebP.
   `--simplify false` (simplifying breaks the morph targets) and
   `--flatten false --join false` (flattening removes the "Armature" node
   TalkingHead looks for; it then warns and falls back) are both required.
7. Check it before shipping: load it in TalkingHead and look at it idle, while
   speaking (the visemes move the mouth) and at the "upper" and "head" views.
