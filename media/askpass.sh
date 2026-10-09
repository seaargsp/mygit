#!/bin/sh
# GIT_ASKPASS / SSH_ASKPASS for mygit: runs the bundled client on VS Code's Node runtime.
ELECTRON_RUN_AS_NODE=1 exec "$MYGIT_ASKPASS_NODE" "$MYGIT_ASKPASS_MAIN" "$@"
