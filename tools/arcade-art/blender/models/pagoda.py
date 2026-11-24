k = Kit('pagoda', 53)
RED='#cf3327'; RED2='#a3281f'; ROOF='#1f9186'; ROOF2='#18796f'; GOLD='#f2b62c'; WH='#f1ead8'; DKW='#4a2a1e'; STN='#c3b79d'; STN2='#a69a82'; LIT='#ffd98a'; BLU='#1f6f9a'
# ---- stone podium, balustrade, stair, lanterns
k.box(15.0,15.0,1.7,(0,0,-0.9),STN2,top=0.97,bev=0.18,fj=0.06)
k.box(12.6,12.6,0.75,(0,0,0.8),STN,bev=0.1,fj=0.05)
for q in range(4):
    k.push(RZ(q*pi/2))
    for x in (-7.0,-3.5,3.5) + (() if q == 0 else (0.0,)):
        k.box(0.5,0.5,1.0,(x,-7.0,0.8),STN,top=0.8,fj=0.05); k.box(0.62,0.62,0.16,(x,-7.0,1.8),STN2,top=0.5)
    for (x0,x1) in ((-7.0,-3.5),(3.5,7.0)) + (() if q == 0 else ((-3.5,3.5),)):
        k.box(x1-x0,0.2,0.16,((x0+x1)/2,-7.0,1.5),'#d2c7ad'); k.box(x1-x0,0.14,0.34,((x0+x1)/2,-7.0,0.95),STN2)
    k.pop()
for i in range(5): k.box(3.6,2.5-0.5*i,0.31,(0,-6.3-(2.5-0.5*i)/2,0.31*i),'#d2c7ad' if i%2 else STN)
for sx in (-1,1):
    k.prism([(-8.9,0.0),(-6.3,0.0),(-6.3,2.0),(-8.9,0.55)],0.4,at=(sx*2.0,0,0),col=STN2,rz=pi/2)
    k.box(0.6,0.6,0.95,(sx*2.75,-8.75,0),STN,top=0.75,fj=0.05); k.box(0.5,0.5,0.46,(sx*2.75,-8.75,0.95),LIT,glow=1)
    k.box(0.9,0.9,0.36,(sx*2.75,-8.75,1.41),STN2,top=0.25); k.box(0.72,0.72,0.1,(sx*2.75,-8.75,0.9),STN2)
def lantern(x, y, z, s=1.0):
    k.strut((x,y,z+0.42*s),(x,y,z+0.9*s),0.025,DKW,seg=3)
    k.lathe([(0.12*s,z+0.4*s),(0.3*s,z+0.14*s),(0.3*s,z-0.14*s),(0.12*s,z-0.4*s)],6,at=(x,y,0),col='#ff8f2e',cols=['#ff8f2e','#ffc24a','#ff8f2e'],glow=1)
    k.box(0.3*s,0.3*s,0.09*s,(x,y,z+0.4*s),DKW); k.box(0.26*s,0.26*s,0.08*s,(x,y,z-0.48*s),GOLD)
def roof(R, z0, h, lift, nu=32, rin=0.3, th=0.3):
    def P(u, v, dz=0.0):
        a = 2*pi*u+pi/4; sq = 1/max(abs(cos(a)),abs(sin(a)))
        r = (rin+(1-rin)*v**0.85)*R*sq
        return (r*cos(a), r*sin(a), z0+h*(1-v)**1.8+lift*((sq-1)/0.414)**2.2*v*v+dz)
    fs = k.sheet(P, nu, 4, ROOF, fj=0.06)
    k.tint(fs, lambda c,n: ROOF2 if int((((atan2(c.y,c.x)-pi/4)/(2*pi)) % 1.0)*nu) % 2 else None)
    k.sheet(lambda u,v: P(u, 0.5+0.5*v, -th-0.3*(1-v)), nu, 1, RED2)
    k.sheet(lambda u,v: P(u, 1.0, -th*v), nu, 1, GOLD)
    for q in range(4):
        pts = [P(q/4, v, 0.1) for v in (0.0,0.3,0.6,0.85,1.0)]
        k.tube(pts, 0.14, col=GOLD, seg=4)
        e = Vector(pts[-1]); d = Vector((e.x,e.y,0)).normalized()
        k.strut(e, e+d*0.55+Vector((0,0,0.8)), 0.16, GOLD, seg=4, r2=0.03, cap=True)
        lantern(e.x-d.x*0.3, e.y-d.y*0.3, e.z-th-1.15)
# ---- five storeys
PITCH = [4.3,4.1,3.9,3.7,3.5]; WB = [9.4,8.0,6.6,5.2,3.9]; NU = [32,32,24,24,24]
z = 1.55
for i in range(5):
    w = WB[i]; bh = PITCH[i]-1.3; hw = w/2; dk = hw+1.15
    k.box(2*dk,2*dk,0.26,(0,0,z-0.06),DKW)
    k.box(w,w,bh,(0,0,z),WH)
    k.box(w+0.24,w+0.24,0.34,(0,0,z+0.14),RED2); k.box(w+0.3,w+0.3,0.42,(0,0,z+bh-0.42),RED)
    for q in range(4):
        k.push(RZ(q*pi/2))
        for x in (-hw,-hw/3,hw/3): k.cyl(0.25,bh,(x,-hw,z),RED,seg=6,cap=False)
        bw = hw*2/3-0.66
        for b in (-1,0,1):
            x = b*hw*2/3; y = -hw
            if i == 0 and q == 0 and b == 0:
                k.box(bw+0.5,0.22,bh-0.62,(x,y-0.05,z+0.2),DKW)
                for sg in (-1,1):
                    k.poly([(x+sg*0.04,y-0.2,z+0.3),(x+sg*(bw/2+0.1),y-0.2,z+0.3),(x+sg*(bw/2+0.1),y-0.2,z+bh-0.6),(x+sg*0.04,y-0.2,z+bh-0.6)],RED2)
                    k.box(0.12,0.08,0.3,(x+sg*0.22,y-0.24,z+1.3),GOLD)
                k.box(1.5,0.12,0.5,(x,y-0.3,z+bh-0.42),GOLD,m=RX(-0.12)); k.box(1.2,0.06,0.3,(x,y-0.37,z+bh-0.3),DKW,m=RX(-0.12))
                continue
            z0 = z+0.85; z1 = z+bh-0.72
            k.poly([(x-bw/2-0.1,y-0.05,z0-0.1),(x+bw/2+0.1,y-0.05,z0-0.1),(x+bw/2+0.1,y-0.05,z1+0.1),(x-bw/2-0.1,y-0.05,z1+0.1)],DKW)
            k.poly([(x-bw/2,y-0.11,z0),(x+bw/2,y-0.11,z0),(x+bw/2,y-0.11,z1),(x-bw/2,y-0.11,z1)],LIT,glow=1)
            for t in (1/3,2/3):
                xx = x-bw/2+bw*t; k.poly([(xx-0.035,y-0.17,z0),(xx+0.035,y-0.17,z0),(xx+0.035,y-0.17,z1),(xx-0.035,y-0.17,z1)],DKW)
            zm = z0+(z1-z0)*0.62; k.poly([(x-bw/2,y-0.17,zm),(x+bw/2,y-0.17,zm),(x+bw/2,y-0.17,zm+0.07),(x-bw/2,y-0.17,zm+0.07)],DKW)
        ry = -dk+0.12
        for (xa,xb) in (((-dk,-1.9),(1.9,dk)) if (i == 0 and q == 0) else ((-dk,dk),)):
            k.box(xb-xa,0.13,0.13,((xa+xb)/2,ry,z+1.02),RED)
            k.poly([(xa,ry,z+0.5),(xb,ry,z+0.5),(xb,ry,z+0.62),(xa,ry,z+0.62)],RED2)
        for x in (-dk+0.1,-dk/2,0.0,dk/2):
            if i == 0 and q == 0 and x == 0.0: continue
            k.strut((x,ry,z+0.2),(x,ry,z+1.05),0.085,RED,seg=4)
        if i == 0 and q == 0:
            for sg in (-1,1): k.strut((sg*1.9,ry,z+0.2),(sg*1.9,ry,z+1.25),0.1,RED,seg=4); k.box(0.3,0.3,0.14,(sg*1.9,ry,z+1.25),GOLD,top=0.4)
        nb = max(4, int(round(w/0.85))); f = (hw+0.8)/(hw+0.15)
        for j in range(nb):
            x0 = -hw-0.15+(w+0.3)*j/nb; x1 = x0+(w+0.3)/nb
            k.poly([(x0,-hw-0.15,z+bh-0.02),(x1,-hw-0.15,z+bh-0.02),(x1*f,-hw-0.8,z+bh+0.56),(x0*f,-hw-0.8,z+bh+0.56)], GOLD if j%2 else BLU)
        k.pop()
    k.box(w+1.6,w+1.6,0.2,(0,0,z+bh+0.5),RED)
    top = (i == 4)
    roof(hw+2.7-0.13*i, z+bh+0.6, 2.3 if top else 1.75, 1.45-0.08*i, nu=NU[i], rin=0.05 if top else 0.3)
    z += PITCH[i]
# ---- the spire
zt = z-PITCH[4]+PITCH[4]-1.3+0.6+2.3
prof = [(1.0,zt-0.6),(0.72,zt-0.1),(0.36,zt+0.25)]
for j in range(5): prof += [(0.24,zt+0.45+j*0.42),(0.8-0.09*j,zt+0.6+j*0.42),(0.24,zt+0.75+j*0.42)]
prof += [(0.18,zt+2.6),(0.4,zt+2.86),(0.0,zt+3.3)]
k.lathe(prof,8,col=GOLD,fj=0.06)
R = k.done()
