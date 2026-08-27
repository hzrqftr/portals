# Font source

`bukhari-script.ttf` is the original download. It is **not** served — only the
subset in `public/fonts/` ships.

Regenerate the subset after changing the wordmark text:

    python -m fontTools.subset fonts-src/bukhari-script.ttf \
      --text="Odometry" --layout-features='*' --flavor=woff2 \
      --output-file=public/fonts/bukhari-script.woff2

Requires `pip install fonttools brotli`.

Licence: Copyright (c) 2015 Mikrojihad, all rights reserved. Free for personal
use; commercial use needs a licence from the foundry.
