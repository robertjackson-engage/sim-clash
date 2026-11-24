k = Kit('tiki', 37)
W1='#a0683a'; W2='#8a5530'; W3='#b57a45'; DKW='#55301a'; RED='#e8372c'; TEAL='#19c2b8'; YEL='#ffd21f'; WHT='#f4f4ee'; EYE='#ffb41f'; BLK='#20232b'
k.cyl(1.0,0.6,(0,0,-0.3),'#8a7c62',seg=8,r2=0.86,fj=0.1,bev=0.05)
for (a,h) in ((0.5,0.5),(1.9,0.4),(3.3,0.55),(4.4,0.42),(5.6,0.5)): k.cyl(0.14,h,(0.86*cos(a),0.86*sin(a),0.25),'#4f9e3a',seg=4,r2=0.0,fj=0.1)
def head(z, w, d, h, col, kind, acc):
    k.box(w,d,h,(0,0,z),col,bev=0.09,fj=0.04); yf = -d/2
    k.box(w*1.1,0.38,h*0.2,(0,yf+0.02,z+h*0.7),mix(col,'#000000',0.22),m=RX(0.2),bev=0.04)
    for sx in (-1,1):
        k.box(w*0.28,0.16,h*0.21,(sx*w*0.25,yf-0.02,z+h*0.47),BLK)
        k.box(w*0.16,0.08,h*0.12,(sx*w*0.25,yf-0.09,z+h*0.515),EYE,glow=1)
        k.box(0.08,0.04,h*0.3,(sx*w*0.43,yf-0.01,z+h*0.12),acc,m=RY(sx*0.35))
        for q in range(3): k.box(0.05,d*0.55,0.07,(sx*(w/2+0.005),0.05,z+h*(0.25+q*0.22)),DKW)
    k.prism([(-w*0.14,0),(w*0.14,0),(w*0.08,h*0.42),(-w*0.08,h*0.42)],0.36,at=(0,yf-0.04,z+h*0.24),col=mix(col,'#ffffff',0.14))
    for q in range(3): k.box(w*0.55,0.05,0.07,(0,d/2+0.005,z+h*(0.25+q*0.22)),DKW)
    if kind == 0:      # a grin full of teeth, square ears
        k.box(w*0.76,0.14,h*0.2,(0,yf-0.02,z+h*0.03),BLK)
        for t in range(6): k.box(w*0.1,0.07,h*0.13,((t-2.5)*w*0.122,yf-0.08,z+h*0.085),WHT)
        for sx in (-1,1): k.box(0.18,d*0.5,h*0.5,(sx*(w/2+0.07),0,z+h*0.3),acc,bev=0.03)
    elif kind == 1:    # a round shout, wide painted wings
        k.cyl(w*0.19,0.14,(0,yf+0.04,z+h*0.13),BLK,seg=8,m=RX(pi/2)); k.cyl(w*0.1,0.06,(0,yf-0.1,z+h*0.1),RED,seg=6,m=RX(pi/2))
        for sx in (-1,1):
            k.prism([(0,0),(0.42,0.25),(0.36,h*0.85),(0,h*0.6)],0.1,at=(sx*w/2,0.05,z+h*0.12),col=acc,m=S(sx,1,1))
            k.poly([(sx*(w/2+0.1),-0.01,z+h*0.3),(sx*(w/2+0.3),-0.01,z+h*0.42),(sx*(w/2+0.27),-0.01,z+h*0.68),(sx*(w/2+0.1),-0.01,z+h*0.56)],YEL)
    else:              # tongue out
        k.box(w*0.5,0.14,h*0.16,(0,yf-0.02,z+h*0.05),BLK)
        k.prism([(-w*0.13,h*0.16),(w*0.13,h*0.16),(w*0.1,-h*0.22),(-w*0.1,-h*0.22)],0.12,at=(0,yf-0.1,z),col=RED)
        for t in (-1,1): k.box(w*0.09,0.07,h*0.11,(t*w*0.19,yf-0.08,z+h*0.1),WHT)
def band(z, w, d, col, c2):
    k.box(w,d,0.16,(0,0,z),col); n = 5
    for q in range(4):
        hw = (w if q%2 == 0 else d)/2; hd = (d if q%2 == 0 else w)/2
        k.push(RZ(q*pi/2))
        for j in range(n):
            x0 = -hw+2*hw*j/n; x1 = x0+2*hw/n
            k.poly([(x0,-hd-0.015,z+0.01),(x1,-hd-0.015,z+0.01),((x0+x1)/2,-hd-0.015,z+0.15)],c2)
        k.pop()
head(0.3,1.36,1.16,1.12,W1,0,RED); band(1.42,1.42,1.22,TEAL,YEL)
head(1.58,1.24,1.06,1.08,W2,1,TEAL); band(2.66,1.3,1.12,RED,WHT)
head(2.82,1.12,0.96,1.04,W3,2,YEL)
k.box(1.2,1.04,0.1,(0,0,3.86),DKW)
zt = 3.92
for (j,c) in enumerate((RED,YEL,TEAL,YEL,RED)):
    a = (j-2)*0.4; L = 0.8+0.2*(2-abs(j-2))
    k.prism([(-0.17,0),(0.17,0.12),(0.12,L*0.75),(0.0,L),(-0.12,L*0.75)],0.1,col=c,m=T(0,0.05,zt)@RY(a))
    k.poly([(-0.02,-0.06,0.05),(0.02,-0.06,0.05),(0.02,-0.06,L*0.8),(-0.02,-0.06,L*0.8)],WHT,m=None) if False else None
for (j,c) in enumerate((TEAL,RED,RED,TEAL)):
    a = (j-1.5)*0.42
    k.prism([(-0.14,0),(0.14,0),(0.0,0.62)],0.08,col=mix(c,'#000000',0.25),m=T(0,0.32,zt)@RY(a))
R = k.done()
