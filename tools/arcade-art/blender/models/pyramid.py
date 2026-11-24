k = Kit('pyramid', 59)
SA0='#c9a055'; SA1='#efd591'; TREAD='#f4e3ad'; CAS='#f1e3c0'; GOLD='#ffcf33'; BLUE='#2a63cf'; RED='#d0382c'; DK='#1c1812'; SM='#e2c173'; SD='#cda95e'; LIT='#ffb347'
NC=14; CH=2.75; HB=46.0; ST=2.2
k.box(2*HB+10,2*HB+10,1.6,(0,0,-1.6),'#d3ae62',top=0.96,bev=0.3,fj=0.04)
# ---- the stepped core: twelve courses of blocks, darker and more worn toward the sand
for i in range(NC):
    w0 = HB-i*ST; z = i*CH; nb = max(3,int(round(w0/2.1))); c = mix(SA0,SA1,(i/(NC-1))**0.8)
    for q in range(4):
        k.push(RZ(q*pi/2))
        k.sheet(lambda u,v:(-w0+2*w0*u,-w0+0.3*v,z+CH*v),nb,1,c,fj=0.1)
        k.poly([(-w0,-w0+0.3,z+CH),(w0,-w0+0.3,z+CH),(w0-ST,-w0+ST,z+CH),(-w0+ST,-w0+ST,z+CH)],mix(c,TREAD,0.6),fj=0.04)
        if i in (5,10):
            for j in range(nb*2):
                x0 = -w0+2*w0*j/(nb*2); x1 = -w0+2*w0*(j+1)/(nb*2)
                k.poly([(x0,-w0+0.08,z+1.3),(x1,-w0+0.08,z+1.3),(x1,-w0+0.19,z+2.3),(x0,-w0+0.19,z+2.3)],(BLUE,GOLD,BLUE,RED)[j%4])
        k.pop()
# ---- what is left of the smooth white casing, and the gold capstone
ZC = NC*CH; HC = 17.9; ZA = 60.2; ZG = 51.5
f = lambda z: HC*(ZA-z)/(ZA-ZC)
hwz = lambda z: HB+ST-ST*z/CH+0.25
k.box(2*HC+0.9,2*HC+0.9,0.9,(0,0,ZC-0.5),BLUE); k.box(2*HC+0.5,2*HC+0.5,0.3,(0,0,ZC+0.4),GOLD)
PATCH = [[(-17,-8,11),(-8,-1,12.3),(5,11,12),(11,17,10)],[(-17,-5,10.5),(-5,3,12.4),(3,17,11.5)],[(-17,0,11),(0,9,9.5),(9,17,12)],[(-17,-9,12),(-9,2,10),(2,17,11.2)]]
for q in range(4):
    k.push(RZ(q*pi/2))
    k.sheet(lambda u,v:((2*u-1)*f(ZC+0.7+(ZG-ZC-0.7)*v),-f(ZC+0.7+(ZG-ZC-0.7)*v),ZC+0.7+(ZG-ZC-0.7)*v),6,4,CAS,fj=0.06)
    for (xa,xb,ci) in PATCH[q]:
        za = ci*CH; A = (xa,-hwz(za),za); B = (xb,-hwz(za),za); C = (xb,-hwz(ZC),ZC-0.4); D = (xa,-hwz(ZC),ZC-0.4)
        k.poly([A,B,C,D],CAS,fj=0.04)
        k.poly([A,D,(xa,-hwz(ZC),za)],mix(CAS,SA0,0.35)); k.poly([B,(xb,-hwz(ZC),za),C],mix(CAS,SA0,0.35))
    k.pop()
k.box(2*f(ZG)+0.5,2*f(ZG)+0.5,0.6,(0,0,ZG-0.3),BLUE)
k.box(2*f(ZG),2*f(ZG),ZA-ZG,(0,0,ZG+0.3),GOLD,top=0,glow=1)
# ---- the terrace, the great stair, the gate
yf = -(HB-3*ST); ZP = 3*CH; TF = -48.0; PY = yf+0.4
k.box(30,yf+1.0-TF,ZP,(0,(TF+yf+1.0)/2,0),SM,top=(0.97,1),fj=0.05)
k.box(31,yf+1.4-TF,0.5,(0,(TF+yf+1.0)/2-0.2,ZP-0.15),TREAD,fj=0.03)
for j in range(20):
    x0 = -14.6+29.2*j/20; x1 = x0+29.2/20
    if abs((x0+x1)/2) < 6.6: continue
    k.poly([(x0,TF-0.07,ZP-1.9),(x1,TF-0.07,ZP-1.9),(x1,TF-0.07,ZP-0.7),(x0,TF-0.07,ZP-0.7)],(BLUE,GOLD)[j%2])
for j in range(9):
    y0 = -59.5+j*1.28
    k.box(10.0,TF+0.1-y0,ZP/9,(0,(y0+TF+0.1)/2,j*ZP/9),TREAD if j%2 else SM)
def brazier(x, y, z, s=1.0):
    k.box(1.7*s,1.7*s,1.9*s,(x,y,z),SD,top=0.8,bev=0.1); k.cyl(0.95*s,0.5*s,(x,y,z+1.9*s),'#8a6a3a',seg=8,r2=1.15*s)
    flame(k,(x,y,z+2.3*s),0.75*s,1.9*s)
for sx in (-1,1):
    k.prism([(-60.6,0.0),(TF+0.1,0.0),(TF+0.1,ZP+1.3),(-60.6,1.7)],1.5,at=(sx*5.75,0,0),col=SD,rz=pi/2,fj=0.05)
    brazier(sx*5.75,-61.0,0.0); brazier(sx*13.6,TF+1.4,ZP,0.8)
    # an obelisk either side of the stair foot
    k.box(2.8,2.8,1.4,(sx*10.5,-56.0,0),SD,bev=0.15); k.box(2.0,2.0,13.0,(sx*10.5,-56.0,1.4),SA1,top=0.62,fj=0.04)
    k.box(1.24,1.24,2.0,(sx*10.5,-56.0,14.4),GOLD,top=0,glow=1)
    for e in range(5): k.poly([(sx*10.5-0.5,-57.02+0.03*e*2.1,3.2+e*2.1),(sx*10.5+0.5,-57.02+0.03*e*2.1,3.2+e*2.1),(sx*10.5+0.5,-57.0+0.03*e*2.1,4.3+e*2.1),(sx*10.5-0.5,-57.0+0.03*e*2.1,4.3+e*2.1)],(BLUE,RED,GOLD)[e%3])
    # a gate tower
    TX = 6.7
    k.box(7.6,5.6,15.5,(sx*TX,PY,ZP),SA1,top=(0.84,0.8),bev=0.15,fj=0.05)
    k.box(7.6*0.84+0.25,5.6*0.8+0.25,0.55,(sx*TX,PY,ZP+15.4),BLUE)
    k.box(7.6*0.84+0.1,5.6*0.8+0.1,1.3,(sx*TX,PY,ZP+15.95),TREAD,top=1.2)
    yt = lambda z: PY-2.8+0.56*(z-ZP)/15.5-0.07
    def panel(xa, xb, za, zb, c, o=0.0, g=0):
        k.poly([(sx*TX+xa,yt(ZP+za)-o,ZP+za),(sx*TX+xb,yt(ZP+za)-o,ZP+za),(sx*TX+xb,yt(ZP+zb)-o,ZP+zb),(sx*TX+xa,yt(ZP+zb)-o,ZP+zb)],c,glow=g)
    panel(-1.5,1.5,1.5,13.4,GOLD); panel(-1.2,1.2,1.8,13.1,BLUE,0.06)
    for e in range(6): panel(-0.6,0.6,2.6+e*1.75,3.6+e*1.75,'#ffd76a',0.12,1)
    k.strut((sx*10.0,PY-3.1,ZP),(sx*10.0,PY-2.6,ZP+22.0),0.14,'#8a5a2c',seg=5)
    k.poly([(sx*10.0,PY-2.6,ZP+22.0),(sx*10.0+3.6,PY-2.6,ZP+21.5),(sx*10.0+2.7,PY-2.6,ZP+20.7),(sx*10.0+3.6,PY-2.6,ZP+19.9),(sx*10.0,PY-2.6,ZP+19.7)],RED if sx < 0 else BLUE)
    k.box(1.0,0.5,8.4,(sx*2.75,PY-0.9,ZP),GOLD); k.box(0.56,0.56,8.4,(sx*2.75,PY-0.9,ZP),BLUE)
k.box(7.0,3.4,8.8,(0,PY+0.6,ZP),DK)
k.poly([(-2.4,PY-1.15,ZP+0.05),(2.4,PY-1.15,ZP+0.05),(2.4,PY-1.15,ZP+8.0),(-2.4,PY-1.15,ZP+8.0)],LIT,glow=1)
k.poly([(-1.4,PY-1.22,ZP+0.05),(1.4,PY-1.22,ZP+0.05),(1.4,PY-1.22,ZP+6.8),(-1.4,PY-1.22,ZP+6.8)],'#ffe9a0',glow=1)
k.box(7.4,4.4,3.6,(0,PY,ZP+8.4),SM,fj=0.04); k.box(7.6,4.6,0.5,(0,PY,ZP+12.0),BLUE); k.box(7.5,4.5,1.0,(0,PY,ZP+12.5),TREAD,top=1.15)
k.cyl(1.1,0.3,(0,PY-2.2,ZP+10.2),GOLD,seg=10,m=RX(pi/2),glow=1)
for sx in (-1,1): k.poly([(sx*1.05,PY-2.26,ZP+10.55),(sx*3.4,PY-2.26,ZP+11.0),(sx*3.3,PY-2.26,ZP+10.2),(sx*1.05,PY-2.26,ZP+9.75)],BLUE)
# ---- two seated colossi on the terrace
def colossus(x, y, z, s=1.0):
    k.push(T(x,y,z)@S(s)); SK = '#e6c57f'
    k.box(3.2,3.9,0.8,(0,0,0),SD,bev=0.1); k.box(2.5,2.0,2.6,(0,0.6,0.8),SM); k.box(2.8,0.55,5.0,(0,1.55,0.8),SM,top=(0.9,1))
    for sx in (-1,1):
        k.box(0.82,2.2,0.8,(sx*0.62,-0.5,2.6),SK); k.box(0.78,0.82,1.9,(sx*0.62,-1.3,0.8),SK); k.box(0.82,1.25,0.32,(sx*0.62,-1.55,0.8),SK)
        k.box(0.55,1.9,0.5,(sx*1.25,-0.3,3.4),SK); k.box(0.6,0.62,1.8,(sx*1.3,0.65,3.5),SK)
    k.box(2.2,1.25,2.5,(0,0.7,3.3),SK,top=(1.18,1),bev=0.18)
    k.box(1.05,1.05,1.25,(0,0.6,5.8),SK,bev=0.2)
    fs = k.prism([(-1.2,5.5),(1.2,5.5),(0.8,7.5),(-0.8,7.5)],1.1,at=(0,0.95,0),col=BLUE)
    k.tint(fs, lambda c,n: GOLD if int(c.z/s*3.3)%2 else None)
    k.box(0.32,0.28,0.95,(0,0.0,5.0),GOLD); k.box(2.3,1.3,0.4,(0,0.7,5.45),GOLD)
    k.pop()
for sx in (-1,1): colossus(sx*12.7,yf-3.3,ZP,1.25)
# ---- fallen blocks round the foot
for i in range(14):
    a = k.rnd.uniform(0,2*pi); r = HB+3+k.rnd.random()*5
    x = max(-HB-6,min(HB+6,r*cos(a))); y = max(-HB-6,min(HB+6,r*sin(a)))
    if abs(x) < 20 and y < 0: continue
    if abs(x) < HB+1 and abs(y) < HB+1: x = (HB+3)*(1 if x > 0 else -1)
    k.box(2.6,2.1,1.9,(x,y,-0.3),(SA0,SM,SA1)[i%3],m=RZ(a)@RX(k.rnd.uniform(-0.3,0.3)),jit=0.08,bev=0.12)
R = k.done()
