k = Kit('castle', 63); k.floor = -1.5
from math import hypot, floor
ST='#e4d6b4'; ST2='#d0c09e'; STD='#a8977a'; TRIM='#8f8168'; DK='#27231f'
BLUE='#2c62cf'; BLUE2='#1f469c'; RED='#d0302a'; RED2='#ab2622'; GOLD='#f5c021'; WOOD='#7a4a28'; LIT='#ffd36a'; LIT2='#ffe9a0'
HW=16.0; WH=9.2; YO=-HW-1.3
def stone(fs, lo=0.2, hi=11.0, c0=ST, c1=STD, j=0.06):
    # masonry: darker and damper at the foot, every block a little its own tone
    for f in fs:
        t = min(1.0, max(0.0, (f.calc_center_median().z-lo)/(hi-lo)))
        k.paint([f], mix(c1, c0, t**0.55), fj=j)
    return fs
def cwall(a, b, z0, z1, rows, bl, bat=0.0, lo=0.2, hi=11.0, j=0.07):
    # a face of coursed stone from a to b (plan), facing the right of a->b: staggered blocks, bat = lean of the foot
    ax,ay = a; bx,by = b; L = hypot(bx-ax, by-ay); n = max(1, int(round(L/bl)))
    nx,ny = (by-ay)/L, -(bx-ax)/L; fs = []
    P = lambda u,o,z: (ax+(bx-ax)*u+nx*o, ay+(by-ay)*u+ny*o, z)
    for r in range(rows):
        t0 = r/rows; t1 = (r+1)/rows
        za = z0+(z1-z0)*t0; zb = z0+(z1-z0)*t1; oa = bat*(1-t0); ob = bat*(1-t1)
        cuts = [0.0] + [(i+(0.5 if r%2 else 0.0))/n for i in range(0 if r%2 else 1, n)] + [1.0]
        for u0,u1 in zip(cuts, cuts[1:]): fs += k.poly([P(u0,oa,za),P(u1,oa,za),P(u1,ob,zb),P(u0,ob,zb)], ST)
    return stone(fs, lo, hi, j=j)
def arch(w, hs, ha, n=4):
    # a pointed arch outline (x, z): half width w, springing at hs, apex at ha
    L = [(w-2*w*cos(radians(60)*i/n), hs+(ha-hs)*sin(radians(60)*i/n)/sin(radians(60))) for i in range(n+1)]
    return [(-w,0.0),(w,0.0)] + [(-x,z) for x,z in L[:-1]] + [(0.0,ha)] + [(x,z) for x,z in reversed(L[:-1])]
def awin(m, w, h, col=LIT, fr=TRIM, glow=1, mull=True, simple=False):
    # an arched window on a wall: m puts its sill centre on the wall face, the wall facing local -Y
    k.push(m)
    A = arch(w/2, h*0.58, h, 2); g = 0.14*w+0.1
    B = [(x*(1+2*g/w), -g if z == 0 else z+g*0.9) for x,z in A]
    if simple: k.poly([(x,-0.08,z) for x,z in B], fr)
    else: k.prism(B, 0.34, at=(0,0,0), col=fr)
    k.poly([(x,-0.16 if simple else -0.24,z) for x,z in A], col, glow=glow)
    if mull:
        o = -0.22 if simple else -0.3
        k.poly([(-0.045*w-0.02,o,0),(0.045*w+0.02,o,0),(0.045*w+0.02,o,h*0.93),(-0.045*w-0.02,o,h*0.93)], fr)
        k.poly([(-w/2,o,h*0.5),(w/2,o,h*0.5),(w/2,o,h*0.5+0.07*w+0.03),(-w/2,o,h*0.5+0.07*w+0.03)], fr)
    k.pop()
def slit(m, h=1.9):
    k.push(m); k.poly([(-0.17,-0.07,0),(0.17,-0.07,0),(0.17,-0.07,h),(-0.17,-0.07,h)], DK); k.pop()
def pennant(x, y, zp, L, col):
    d = k.xf[-1].inverted().to_3x3() @ Vector((1,0,0)); px,py = d.x,d.y; wx,wy = -d.y*0.13*L, d.x*0.13*L
    A=(x,y,zp); B=(x+px*L*0.5+wx,y+py*L*0.5+wy,zp-0.04*L); C=(x+px*L*0.5+wx,y+py*L*0.5+wy,zp-0.5*L); D=(x,y,zp-0.54*L)
    E=(x+px*L,y+py*L,zp-0.07*L); F=(x+px*L*0.76+wx*0.5,y+py*L*0.76+wy*0.5,zp-0.27*L); G=(x+px*L,y+py*L,zp-0.48*L)
    k.poly([A,B,C,D], col); k.poly([B,E,F,G,C], mix(col,'#000000',0.14))
def banner(x, y, z, w, h, col=RED, em=GOLD):
    k.box(w+0.5,0.14,0.14,(x,y,z),'#3a2c1c')
    k.poly([(x-w/2,y-0.06,z-h),(x,y-0.06,z-h+w*0.5),(x+w/2,y-0.06,z-h),(x+w/2,y-0.06,z),(x-w/2,y-0.06,z)], col)
    k.poly([(x-w/2,y-0.12,z-0.5),(x+w/2,y-0.12,z-0.5),(x+w/2,y-0.12,z-0.12),(x-w/2,y-0.12,z-0.12)], em)
    c = z-h*0.48; s = w*0.3
    k.poly([(x,y-0.12,c-s*1.3),(x+s,y-0.12,c),(x,y-0.12,c+s*1.3),(x-s,y-0.12,c)], em)
def orb(x, y, z, s, col=GOLD):
    k.lathe([(0,z-s),(s*0.8,z-s*0.45),(s*0.8,z+s*0.45),(0,z+s)], 6, at=(x,y,0), col=col)
def rtower(x, y, r, h, z0=0.2, seg=12, roofc=(BLUE,BLUE2), roof=True, rh=2.7, foot='bat', wins=((0.47,0),(0.74,1)), ws=1.0, flag=RED, pole=None, lit=LIT, simple=True):
    XI = k.xf[-1].inverted()
    nb = max(3, int(round(h/1.8)))
    prof = [(r*(1+(0.22*max(0.0,1-(i/nb)/0.3) if foot == 'bat' else 0.0)), z0+h*i/nb) for i in range(nb+1)]
    stone(k.lathe(prof, seg, at=(x,y,0), col=ST), z0, z0+h*1.1, j=0.07)
    if foot == 'corb': k.lathe([(0.25,z0-r*1.6),(r*0.62,z0-r*0.7),(r,z0)], seg, at=(x,y,0), col=ST2, cols=[TRIM,ST2], fj=0.05)
    zt = z0+h
    fs = k.lathe([(r,zt-1.1),(r*1.27,zt-0.1),(r*1.27,zt+1.3),(r*1.03,zt+1.3),(r*1.03,zt+0.3),(0,zt+0.3)], seg, at=(x,y,0), col=ST2, fj=0.05)
    def mach(c, n):
        if n.z > -0.3: return None
        p = XI @ c
        return DK if int(floor(atan2(p.y-y, p.x-x)/(2*pi)*seg+4*seg)) % 2 else TRIM
    k.tint(fs, mach)
    ch = 2*r*1.27*sin(pi/seg)
    for j in range(seg//2):
        a = (2*j+0.5)*2*pi/seg+pi/2
        k.box(ch*0.95, r*0.25, 1.0, (0,0,0), ST, m=T(x,y,zt+1.3)@RZ(a)@T(0,-r*1.11,0))
    ap = r*cos(pi/seg)+0.04; ww = min(1.0, 2*r*sin(pi/seg)*0.5)*ws
    for (t,o) in wins:
        for j in range(4):
            a = (j*(seg//4)+o+0.5)*2*pi/seg+pi/2
            awin(T(x,y,z0+h*t)@RZ(a)@T(0,-ap,0), ww, ww*2.3, col=lit, simple=simple)
    if not roof:
        zp = zt+4.6
        k.strut((x,y,zt+0.3),(x,y,zp),0.07,'#efe9d8',seg=4); orb(x,y,zp,0.24)
        if flag: pennant(x,y,zp-0.1,2.6,flag)
        return zp
    k.cyl(r*0.8, 2.7, (x,y,zt+0.3), ST, seg=seg, fj=0.05)
    ze = zt+2.6; H = r*rh; re = r*1.04
    k.lathe([(re*0.78,ze-0.4),(re*1.05,ze-0.32),(re*1.05,ze)], seg, at=(x,y,0), col=roofc[1])
    k.lathe([(re,ze),(re*0.66,ze+H*0.13),(re*0.43,ze+H*0.4),(re*0.2,ze+H*0.73),(0,ze+H)], seg, at=(x,y,0), col=roofc[0], cols=[roofc[1],roofc[0],roofc[1],roofc[0]], fj=0.08)
    ztip = ze+H
    k.cyl(r*0.08+0.07, r*0.45, (x,y,ztip-r*0.2), GOLD, seg=5, r2=0.03); orb(x,y,ztip+0.1,r*0.11+0.12)
    if flag:
        zp = ztip+(pole or r*0.8)
        k.strut((x,y,ztip),(x,y,zp),0.05+r*0.008,'#efe9d8',seg=4); pennant(x,y,zp,r*0.7+0.7,flag)
        return zp
    return ztip
# ---- the rock it stands on, the yard
stone(k.box(44,44,2.0,(0,0,-1.5),STD,top=0.955,bev=0.5), -1.5, 2.5, c0=ST2, c1='#82786a', j=0.07)
k.box(28.5,28.5,0.16,(0,0,0.45),'#b7a783',fj=0.05)
# ---- curtain walls
for q in range(4):
    k.push(RZ(q*pi/2))
    k.box(2*HW,2.3,WH+0.4,(0,-HW+0.15,0.2),ST2)
    cwall((-HW,YO),(HW,YO),0.2,3.4,2,2.9,bat=0.8,hi=13)
    cwall((-HW,YO),(HW,YO),3.4,WH,4,2.9,hi=13)
    n = 26
    for i in range(n):
        x0 = -HW+2*HW*i/n; x1 = -HW+2*HW*(i+1)/n
        k.poly([(x0,YO,WH-0.1),(x1,YO,WH-0.1),(x1,YO-0.7,WH+0.75),(x0,YO-0.7,WH+0.75)], DK if i%2 else TRIM)
    k.box(2*HW,3.3,0.4,(0,-HW-0.35,WH+0.4),ST2,fj=0.04)
    k.box(2*HW,0.6,1.3,(0,YO-0.4,WH+0.8),ST2)
    k.box(2*HW,0.7,0.16,(0,YO-0.4,WH+0.8),TRIM)
    for j in range(12):
        x = -HW+1.35+j*2.664
        if q == 0 and abs(x) < 7.5: continue
        k.box(1.5,0.6,1.1,(x,YO-0.4,WH+2.1),ST)
    if q > 0:
        for x in (-8.3,8.3): stone(k.box(2.0,1.7,7.6,(x,YO-0.75,0.2),ST2,top=(0.8,0.3),bev=0.15), 0.2, 11)
        for x in (-12.2,-4.4,4.4,12.2): slit(T(x,YO,5.3))
        rtower(0,-HW-1.2,2.9,12.4 if q != 2 else 14.6,roof=(q == 2),rh=2.9,wins=((0.62,1),),simple=True,flag=RED if q == 2 else BLUE)
    k.pop()
for (sx,sy) in ((-1,-1),(1,-1),(1,1),(-1,1)): rtower(sx*HW,sy*HW,3.6,13.5 if sy < 0 else 16.5,rh=3.0)
# ---- gatehouse
GF = -HW-3.8
k.box(11.0,6.0,13.8,(0,GF+3.3,0.2),ST2)
cwall((-5.5,GF),(5.5,GF),0.2,14.0,8,2.2,hi=17)
A = arch(2.4,4.4,7.9)
k.prism([(x*1.26,z*1.08) for x,z in A],0.7,at=(0,GF-0.1,0.2),col=TRIM,fj=0.05)
k.poly([(x,GF-0.5,z+0.2) for x,z in A],DK)
def archz(x): 
    c = (abs(x)+2.4)/4.8; return 4.4+(7.9-4.4)*sqrt(max(0.0,1-c*c))/sin(radians(60))+0.2
for j in range(5):
    x = -1.8+j*0.9; k.strut((x,GF-0.58,3.3),(x,GF-0.58,archz(x)-0.05),0.075,'#5b6370',seg=4); k.cyl(0.075,0.4,(x,GF-0.58,2.9),'#5b6370',seg=4,r2=0.0,m=RX(pi)@T(0,0,-0.4))
for z in (3.6,4.9,6.1): 
    w = 2.25 if z < 4.6 else 2.4*(2*sqrt(max(0.0,1-((z-4.6)*sin(radians(60))/3.5)**2))-1)
    k.strut((-w,GF-0.58,z),(w,GF-0.58,z),0.065,'#5b6370',seg=4)
for sx in (-1,1):
    rtower(sx*6.0,GF+0.3,2.4,15.2,rh=3.0,flag=RED)
    banner(sx*6.0,GF-2.5,11.6,1.5,5.6)
    k.box(0.16,0.7,0.12,(sx*3.15,GF-0.4,6.3),DK); k.box(0.46,0.46,0.66,(sx*3.15,GF-0.75,5.55),'#ffb347',glow=1); k.box(0.6,0.6,0.12,(sx*3.15,GF-0.75,6.2),DK,top=0.5)
    awin(T(sx*1.9,GF,9.5),0.9,2.2)
    k.strut((sx*2.3,GF-6.0,0.35),(sx*2.75,GF-0.3,8.7),0.07,'#3d4450',seg=3)
k.box(7.4,0.45,0.36,(0,GF-0.05,8.3),TRIM); k.box(7.4,0.45,0.36,(0,GF-0.05,12.5),TRIM)
k.prism([(-0.95,2.0),(0.95,2.0),(0.95,0.9),(0,0),(-0.95,0.9)],0.3,at=(0,GF-0.2,9.4),col=GOLD)
k.poly([(-0.68,GF-0.4,11.15),(-0.68,GF-0.4,10.4),(0,GF-0.4,9.75),(0.68,GF-0.4,10.4),(0.68,GF-0.4,11.15)],RED)
for i in range(8):
    x0 = -3.7+7.4*i/8; x1 = -3.7+7.4*(i+1)/8
    k.poly([(x0,GF,13.3),(x1,GF,13.3),(x1,GF-0.6,14.0),(x0,GF-0.6,14.0)], DK if i%2 else TRIM)
k.box(7.4,0.6,1.2,(0,GF-0.3,14.0),ST2)
for j in range(3): k.box(1.4,0.6,1.0,(-2.5+j*2.5,GF-0.3,15.2),ST)
k.box(9.4,5.0,4.4,(0,GF+3.3,14.0),RED2,top=(0.5,0.0),fj=0.07)
for j in range(8): k.box(5.0,0.8,0.3,(0,GF-0.7-j*0.8,0.42-j*0.08),WOOD,jit=0.12)
for sx in (-1,1): k.box(0.3,6.6,0.3,(sx*2.5,GF-3.9,0.2),'#5e3a20',m=RX(0.1))
# ---- the keep
KY=3.0; KW=14.0; KD=13.0; KZ=19.4
k.box(KW-0.6,KD-0.6,KZ,(0,KY,0.2),ST2)
for q in range(4):
    k.push(T(0,KY,0)@RZ(q*pi/2))
    hw = (KW if q%2 == 0 else KD)/2; hd = (KD if q%2 == 0 else KW)/2
    cwall((-hw,-hd),(hw,-hd),0.2,KZ+0.2,10,2.4,hi=24)
    for x in (-hw*0.5,0,hw*0.5):
        awin(T(x,-hd,10.0),1.3,3.5); awin(T(x,-hd,15.5),1.0,2.4,col=LIT2)
    for x in (-hw*0.5,hw*0.5): slit(T(x,-hd,4.8),2.1)
    k.box(2*hw+0.5,0.5,0.4,(0,-hd-0.05,8.8),TRIM); k.box(2*hw+0.5,0.5,0.4,(0,-hd-0.05,14.3),TRIM)
    for i in range(12):
        x0 = -hw-0.6+(2*hw+1.2)*i/12; x1 = -hw-0.6+(2*hw+1.2)*(i+1)/12
        k.poly([(x0,-hd,KZ-0.6),(x1,-hd,KZ-0.6),(x1,-hd-0.6,KZ+0.2),(x0,-hd-0.6,KZ+0.2)], DK if i%2 else TRIM)
    k.box(2*hw+1.2,0.6,1.2,(0,-hd-0.3,KZ+0.2),ST2)
    for j in range(4): k.box(1.5,0.6,1.1,(-hw+2.6+j*(2*hw-5.2)/3,-hd-0.3,KZ+1.4),ST)
    k.pop()
k.box(KW+1.2,KD+1.2,0.4,(0,KY,KZ-0.1),ST2)
for (sx,sy) in ((-1,-1),(1,-1),(1,1),(-1,1)):
    stone(k.box(2.0,2.0,11.4,(sx*KW/2,KY+sy*KD/2,0.2),ST2,bev=0.25), 0.2, 24)
    rtower(sx*KW/2,KY+sy*KD/2,1.85,8.0,z0=13.6,seg=8,foot='corb',rh=3.0,wins=((0.55,0),),flag=None,simple=True)
rtower(0,KY+0.4,4.3,8.0,z0=KZ+0.2,seg=16,foot=None,rh=2.6,wins=((0.34,1),),ws=1.45,pole=2.0)
banner(0,KY-KD/2-0.25,8.2,2.0,5.2)
k.push(T(0,KY-KD/2,0.4)); D = arch(1.0,2.0,3.3,3)
k.prism([(x*1.3,z*1.1) for x,z in D],0.5,col=TRIM); k.poly([(x,-0.3,z) for x,z in D],WOOD); k.poly([(-0.05,-0.36,0),(0.05,-0.36,0),(0.05,-0.36,3.2),(-0.05,-0.36,3.2)],DK)
k.box(3.4,1.4,0.25,(0,-0.9,0.0),ST2); k.box(4.2,1.4,0.2,(0,-1.7,-0.1),STD)
k.pop()
# ---- hall and chapel in the yard
def house(x, y, w, d, h, rh, roofc):
    k.push(T(x,y,0))
    stone(k.box(w,d,h,(0,0,0.2),ST), 0.2, h+4)
    k.prism([(-w/2,0),(w/2,0),(0,rh)],d,at=(0,0,0.2+h),col=ST2,rz=0)
    k.prism([(-w/2-0.6,-0.4),(0,rh+0.1),(w/2+0.6,-0.4),(w/2+0.6,0.1),(0,rh+0.7),(-w/2-0.6,0.1)],d+0.9,at=(0,0,0.2+h),col=roofc,fj=0.06)
    k.box(0.3,d+1.1,0.3,(0,0,0.2+h+rh+0.5),mix(roofc,'#000000',0.25))
    k.pop()
house(10.6,4.2,6.2,15.0,6.8,4.6,RED2)
for y in (-0.5,4.2,8.9): awin(T(10.6-3.1,y,2.6)@RZ(-pi/2),0.9,2.4,mull=False)
awin(T(10.6,4.2-7.5,3.0),1.0,2.6)
k.box(1.2,1.2,5.0,(12.2,8.5,7.0),ST2,fj=0.06); k.box(1.5,1.5,0.3,(12.2,8.5,12.0),TRIM)
house(-10.7,3.2,5.6,11.0,8.6,5.6,BLUE2)
k.cyl(1.0,0.2,(-10.7,3.2-5.62,9.8),LIT,seg=8,m=RX(pi/2),glow=1); k.cyl(1.25,0.16,(-10.7,3.2-5.56,9.8),TRIM,seg=8,m=RX(pi/2))
for y in (0.4,3.2,6.0): awin(T(-10.7+2.8,y,3.0)@RZ(pi/2),0.8,3.2,mull=False)
k.box(1.7,1.7,3.4,(-10.7,3.2-3.6,12.6),ST,fj=0.05); k.box(2.2,2.2,4.6,(-10.7,3.2-3.6,16.0),BLUE,top=0.0,fj=0.07); orb(-10.7,3.2-3.6,20.8,0.32)
def cyp(x, y, h, z=0.45):
    k.cyl(0.22,h*0.2,(x,y,z),WOOD,seg=5); k.lathe([(h*0.15,h*0.14),(h*0.2,h*0.36),(h*0.13,h*0.7),(0,h)],7,at=(x,y,z),col='#2f7d3a',fj=0.1)
for (x,y,h) in ((19.7,-8.5,7.5),(19.6,6.5,6.2),(-19.7,-8.5,6.6),(-19.6,7.0,7.8),(-8.5,19.7,7.0),(8.8,19.6,6.0),(6.6,-23.6,6.4),(-6.6,-23.6,7.0)): cyp(x,y,h,0.45 if y > -22 else 0.0)
for (sx,sy,rr) in ((-1,-1,2.5),(1,-1,2.1),(1,1,2.6),(-1,1,2.2)): stone(k.rock(rr,(sx*20.4,sy*20.4,-0.2),STD,sub=1,sc=(1.2,1.2,0.95),amp=0.25), -1.5, 3, c0=ST2, c1='#82786a', j=0.08)
for (x,y,rr) in ((19.8,-1,1.3),(-19.8,-0.5,1.5),(0.5,19.9,1.4),(13.5,-20.3,1.3),(-13.2,-20.3,1.5),(19.5,13.5,1.2)): k.rock(rr,(x,y,0.6),'#4a9a38',sub=1,sc=(1.3,1.1,0.8),fj=0.12)
R = k.done()
