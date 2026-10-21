import sys
for p in sys.argv[1:]:
    b = open(p, 'rb').read()
    b = b.replace(b'\r\n', b'\n').replace(b'\n', b'\r\n')
    open(p, 'wb').write(b)
    print(p, b.count(b'\r\n'), b.count(b'\n'))
