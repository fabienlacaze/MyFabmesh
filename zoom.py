import sys
from PIL import Image
src, out, part = sys.argv[1], sys.argv[2], int(sys.argv[3])
im = Image.open(src)
x0, x1 = (0, 850) if part == 1 else (850, 1700)
im.crop((x0, 275, x1, 478)).resize(((x1-x0)*2, 203*2), Image.LANCZOS).save(out)
