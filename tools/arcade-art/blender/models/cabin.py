k = Kit('cabin', 83); k.floor = -0.7
LOG='#a0683a'; LOG2='#7d4d28'; LOG3='#b0743f'; END='#dcb47c'; SNOW='#f7fbff'; SNOW2='#dce8f5'; STN='#9a958c'; DKW='#5a3319'; SHG='#7c4628'; SHG2='#653719'; RED='#c8322a'; RED2='#a82a22'; LIT='#ffd76a'; WHT='#f4efe0'
W=8.0; D=6.0; ZL=0.8; ZW=4.6; RS=0.66; yf=-D/2-0.33; HP=(W/2+0.2)*RS
fs = k.cyl(6.3,1.05,(0,-0.4,-0.7),SNOW,seg=12,m=S(1,0.87,1),bev=0.32,fj=0.015)
k.rough(fs,0.28,0.3,seed=3.0)
k.tint(fs, lambda c,n: SNOW2 if n.z < 0.35 else None)
# ---- fieldstone footing
for q in range(4):
    L = (W if q%2 == 0 else D)+0.9; off = (D if q%2 == 0 else W)/2+0.45
    k.push(RZ(q*pi/2)); k.sheet(lambda u,v:(-L/2+L*u,-off,0.05+0.8*v),int(L/1.1),2,STN,fj=0.16); k.pop()
k.box(W+0.9,D+0.9,0.1,(0,0,0.8),'#84807a')
# ---- log walls: chinking behind, the log ends showing their rings
for sy in (-1,1): k.box(W-0.2,0.3,ZW-ZL-0.1,(0,sy*D/2,ZL+0.1),'#c9bb9b')
for sx in (-1,1): k.box(0.3,D-0.2,ZW-ZL-0.1,(sx*W/2,0,ZL+0.1),'#c9bb9b')
for i in range(7):
    z = ZL+0.33+i*0.5
    for sy in (-1,1):
        fs = k.cyl(0.28,W+1.2,(-(W+1.2)/2,sy*D/2,z),LOG if i%2 else LOG3,seg=6,m=RY(pi/2),fj=0.07); k.tint(fs, lambda c,n: END if abs(n.x) > 0.9 else None)
    for sx in (-1,1):
        fs = k.cyl(0.28,D+1.2,(sx*W/2,-(D+1.2)/2,z+0.25),LOG2 if i%2 else LOG,seg=6,m=RX(-pi/2),fj=0.07); k.tint(fs, lambda c,n: END if abs(n.y) > 0.9 else None)
# ---- plank gables, an attic light
for sy in (-1,1):
    y = sy*(D/2+0.06); n = 9; ww = (W+0.4)/n
    for j in range(n):
        x0 = -W/2-0.2+ww*j; x1 = x0+ww; h0 = (W/2+0.2-abs(x0))*RS; h1 = (W/2+0.2-abs(x1))*RS
        P = [(x0,y,ZW),(x1,y,ZW),(x1,y,ZW+h1)] + ([(0.0,y,ZW+HP)] if x0 < 0 < x1 else []) + [(x0,y,ZW+h0)]
        P = [p for a,p in enumerate(P) if all(abs(p[2]-o[2])+abs(p[0]-o[0]) > 1e-4 for o in P[:a])]
        k.poly(P, LOG3 if j%2 else LOG, fj=0.05)
    k.box(W+0.6,0.2,0.24,(0,y,ZW-0.12),DKW)
k.cyl(0.62,0.14,(0,-D/2-0.06,ZW+1.25),WHT,seg=8,m=RX(pi/2)); k.cyl(0.46,0.2,(0,-D/2-0.06,ZW+1.25),LIT,seg=8,m=RX(pi/2),glow=1)
k.box(0.07,0.06,0.9,(0,-D/2-0.31,ZW+0.8),WHT); k.box(0.9,0.06,0.07,(0,-D/2-0.31,ZW+1.215),WHT)
# ---- roof: boards, shingle courses, a blanket of snow that has slid off the eaves, icicles
EX = W/2+1.1; ZE = ZW-0.9*RS; YA = -4.35; YB = 3.85; YM = (YA+YB)/2; RD = YB-YA; ZR = ZW+HP
k.prism([(-EX,ZE),(0,ZR),(EX,ZE),(EX,ZE+0.28),(0,ZR+0.32),(-EX,ZE+0.28)],RD,at=(0,YM,0),col=DKW)
zs = lambda x: ZE+0.36+(ZR+0.04-ZE)*(1-abs(x)/(EX+0.12))
XS = 3.85
for sx in (-1,1):
    fs = k.sheet(lambda u,v:(sx*(EX+0.12)*(1-v),YA-0.08+(RD+0.16)*u,zs((EX+0.12)*(1-v))),9,6,SHG,fj=0.1)
    k.tint(fs, lambda c,n: SHG2 if int((1-abs(c.x)/(EX+0.12))*6) % 2 else None)
    for j in range(10):
        y = YA+0.35+j*0.83; L = 0.28+0.4*((j*7+(3 if sx > 0 else 0))%4)/3
        k.cyl(0.07,L,(sx*(EX+0.06),y,ZE+0.34),'#cfeaff',seg=4,r2=0.0,m=RX(pi))
    for (y,r) in (((-2.7,0.6),(1.6,0.5)) if sx < 0 else ((-0.9,0.55),(2.9,0.6))):
        k.rock(r,(sx*(XS+0.25),y,zs(XS+0.25)+0.1),SNOW,sub=1,sc=(1.3,1.7,0.45),amp=0.2,fj=0.02)
    for y in (YA-0.03,YB+0.03):
        k.box(EX/cos(atan2(RS,1.0))+0.25,0.13,0.36,(0,0,0),RED2,m=T(sx*EX/2,y,(ZE+ZR)/2-0.02)@RY(sx*atan2(RS,1.0)))
k.prism([(-XS,zs(XS)+0.02),(0,zs(0)+0.02),(XS,zs(XS)+0.02),(XS+0.14,zs(XS)+0.44),(0,zs(0)+0.62),(-XS-0.14,zs(XS)+0.44)],RD+0.34,at=(0,YM,0),col=SNOW,bev=0.13)
k.box(0.18,0.18,1.0,(0,YA-0.06,ZR+0.0),RED2); k.box(0.3,0.3,0.14,(0,YA-0.06,ZR+1.0),SNOW,bev=0.04)
# ---- fieldstone chimney
CX = 2.4; CY = 1.2
k.box(1.2,1.2,3.5,(CX,CY,5.0),'#8d8880')
for q in range(4):
    k.push(T(CX,CY,0)@RZ(q*pi/2)); k.sheet(lambda u,v:(-0.68+1.36*u,-0.68,5.0+3.5*v),2,6,STN,fj=0.18); k.pop()
k.box(1.72,1.72,0.28,(CX,CY,8.38),'#75716a'); k.box(1.78,1.78,0.2,(CX,CY,8.66),SNOW,bev=0.07); k.box(0.8,0.8,0.5,(CX,CY,8.5),'#3a3531')
# ---- windows, shutters, snow on the sills
def win(m, sh=True):
    k.push(m)
    k.box(1.62,0.3,1.52,(0,0,0),WHT)
    k.poly([(-0.66,-0.17,0.12),(0.66,-0.17,0.12),(0.66,-0.17,1.4),(-0.66,-0.17,1.4)],LIT,glow=1)
    k.poly([(-0.66,-0.21,0.12),(0,-0.21,0.12),(0,-0.21,0.74),(-0.66,-0.21,0.74)],'#ffe9a0',glow=1)
    k.box(0.09,0.06,1.3,(0,-0.25,0.11),WHT); k.box(1.34,0.06,0.09,(0,-0.25,0.72),WHT)
    k.box(1.9,0.36,0.16,(0,-0.02,1.52),DKW); k.box(1.9,0.5,0.2,(0,-0.14,-0.14),SNOW,bev=0.07)
    if sh:
        for sx in (-1,1):
            k.box(0.52,0.1,1.5,(sx*1.09,-0.06,0.01),RED)
            for z in (0.22,1.12): k.poly([(sx*1.09-0.22,-0.13,z),(sx*1.09+0.22,-0.13,z),(sx*1.09+0.22,-0.13,z+0.14),(sx*1.09-0.22,-0.13,z+0.14)],'#e8695c')
    k.pop()
win(T(-2.75,yf+0.12,ZL+1.25)); win(T(2.75,yf+0.12,ZL+1.25))
win(T(-W/2-0.21,0.3,ZL+1.25)@RZ(-pi/2)); win(T(W/2+0.21,-0.9,ZL+1.25)@RZ(pi/2),sh=False); win(T(-1.6,D/2+0.21,ZL+1.25)@RZ(pi))
# ---- door with a wreath, porch, lantern, bench
k.box(1.6,0.24,2.5,(0,yf+0.05,ZL+0.02),WHT); k.box(1.24,0.12,2.2,(0,yf-0.1,ZL+0.06),'#8a2f22')
for x in (-0.21,0.21): k.poly([(x-0.02,yf-0.17,ZL+0.1),(x+0.02,yf-0.17,ZL+0.1),(x+0.02,yf-0.17,ZL+2.2),(x-0.02,yf-0.17,ZL+2.2)],'#5e1f17')
k.box(0.1,0.1,0.1,(0.45,yf-0.2,ZL+1.1),'#f5c021')
k.lathe([(0.3,0),(0.4,0.07),(0.3,0.14),(0.2,0.07)],8,col='#2f9a3a',m=T(0,yf-0.17,ZL+1.75)@RX(pi/2),fj=0.1); k.box(0.2,0.08,0.14,(0,yf-0.33,ZL+1.38),RED)
k.box(3.8,2.1,0.3,(0,yf-1.05,ZL-0.28),'#8a5530',fj=0.05); k.box(2.8,0.6,0.26,(0,yf-2.4,ZL-0.54),'#7a4a28')
k.box(3.9,2.15,0.08,(0,yf-1.05,ZL+0.02),SNOW2) if False else None
for sx in (-1,1):
    k.box(0.22,0.22,2.6,(sx*1.75,yf-1.9,ZL+0.02),LOG2); k.strut((sx*1.75,yf-1.9,ZL+2.0),(sx*1.2,yf-1.9,ZL+2.52),0.06,LOG2)
    k.box(0.1,1.75,0.1,(sx*1.75,yf-1.0,ZL+0.95),LOG2)
    k.strut((sx*1.75,yf-0.15,ZL+0.08),(sx*1.75,yf-1.85,ZL+0.92),0.045,LOG3); k.strut((sx*1.75,yf-0.15,ZL+0.92),(sx*1.75,yf-1.85,ZL+0.08),0.045,LOG3)
k.box(3.9,0.2,0.2,(0,yf-1.9,ZL+2.5),LOG2)
k.box(4.3,2.5,0.14,(0,yf-1.05,ZL+2.72),SHG,m=RX(0.14)); k.box(4.4,2.5,0.3,(0,yf-1.0,ZL+2.84),SNOW,m=RX(0.14),bev=0.1)
for j in range(5): k.cyl(0.06,0.22+0.2*((j*5)%3)/2,(-1.9+j*0.95,yf-2.22,ZL+2.56),'#cfeaff',seg=4,r2=0.0,m=RX(pi))
k.strut((1.25,yf-1.75,ZL+2.5),(1.25,yf-1.75,ZL+2.12),0.02,'#22201f',seg=3); k.box(0.28,0.28,0.38,(1.25,yf-1.75,ZL+1.76),'#ffb347',glow=1); k.box(0.38,0.38,0.08,(1.25,yf-1.75,ZL+2.12),'#22201f',top=0.5)
k.box(1.2,0.42,0.09,(-1.05,yf-0.42,ZL+0.5),LOG3); k.box(1.2,0.08,0.5,(-1.05,yf-0.2,ZL+0.62),LOG3)
for x in (-1.55,-0.55): k.box(0.1,0.38,0.48,(x,yf-0.42,ZL+0.02),LOG2)
# ---- firewood under a lean-to, a sled, skis, a young fir, drifts
for r in range(3):
    for j in range(5-r):
        fs = k.cyl(0.2,1.3,(W/2+0.62,-2.3+j*0.42+r*0.21,ZL-0.2+r*0.36),LOG3,seg=6,m=RY(pi/2),fj=0.1); k.tint(fs, lambda c,n: END if abs(n.x) > 0.9 else None)
for y in (-2.7,-0.2): k.box(0.12,0.12,1.9,(W/2+1.85,y,ZL-0.4),LOG2)
k.box(1.7,3.1,0.1,(W/2+1.1,-1.45,ZL+1.42),SHG,m=RY(0.22)); k.box(1.75,3.2,0.24,(W/2+1.1,-1.45,ZL+1.52),SNOW,m=RY(0.22),bev=0.08)
k.box(0.5,1.3,0.07,(-5.0,-3.3,0.62),RED,m=RX(0.08))
for sx in (-1,1): k.tube([(-5.0+sx*0.22,-2.7,0.42),(-5.0+sx*0.22,-3.9,0.42),(-5.0+sx*0.22,-4.15,0.6),(-5.0+sx*0.22,-4.1,0.8)],0.03,col='#3a3531',seg=3)
for sx in (-1,1): k.strut((-5.0+sx*0.22,-3.0,0.44),(-5.0+sx*0.22,-3.0,0.64),0.025,'#3a3531',seg=3); k.strut((-5.0+sx*0.22,-3.6,0.44),(-5.0+sx*0.22,-3.6,0.6),0.025,'#3a3531',seg=3)
k.box(0.16,0.05,2.3,(-3.75,yf-0.3,ZL-0.1),'#e8b23a',m=RX(-0.14)); k.box(0.16,0.05,2.3,(-3.5,yf-0.3,ZL-0.1),'#2f7fe8',m=RX(-0.16))
FX = -5.0; FY = 3.3
k.cyl(0.15,0.9,(FX,FY,0.2),LOG2,seg=5)
for (r,z0,h) in ((1.35,0.9,1.6),(1.05,1.9,1.5),(0.7,2.9,1.4)):
    k.cyl(r,h,(FX,FY,z0),'#2f7a48',seg=7,r2=0.0,fj=0.1); k.cyl(r*0.66,h*0.56,(FX,FY,z0+h*0.5),SNOW,seg=7,r2=0.0)
for (x,y,r) in ((4.9,-4.2,0.75),(-4.3,-4.5,0.6),(4.6,3.9,0.9),(0.5,4.4,0.8)): k.rock(r,(x,y,0.1),SNOW,sub=1,sc=(1.4,1.2,0.55),amp=0.18,fj=0.02)
R = k.done()
