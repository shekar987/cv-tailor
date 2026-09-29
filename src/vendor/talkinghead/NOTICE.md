# Vendored: TalkingHead

`talkinghead.mjs`, `dynamicbones.mjs`, `retargeter.mjs`, `lipsync-en.mjs` and
`playback-worklet.js` are from TalkingHead by Mika Suominen
(https://github.com/met4citizen/TalkingHead, commit b3e277b), MIT licence (see
`LICENSE`). Vendored rather than installed from npm because the npm 1.7.0
release lacks the meshopt decoder the compressed avatars need, and its
computed lip-sync import breaks the Turbopack build. One change: that import
in `talkinghead.mjs` carries `webpackIgnore`/`turbopackIgnore` comments (the
mock interview registers the English lip-sync module itself). `three` comes
from npm.
