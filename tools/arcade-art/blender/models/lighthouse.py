k = Kit('lighthouse', 71); k.floor = -1.2
WHT='#f3efe4'; RED='#d2342a'; RED2='#a92820'; ROCK='#857c70'; ROCK2='#6d655b'; GRASS='#5fa044'; STN='#b9b09c'; STN2='#9d9482'; DK='#2a2d33'; LIT='#ffe27a'; WOOD='#7a4a28'; TEAL='#1f7f86'
TX=-2.4; TY=0.6; Z0=2.9
def arch(w, hs, ha, n=3):
    L = [(w-2*w*cos(radians(60)*i/n), hs+(ha-hs)*sin(radians(60)*i/n)/sin(radians(60))) for i in range(n+1)]
    return [(-w,0.0),(w,0.0)] + [(-x,z) for x,z in L[:-1]] + [(0.0,ha)] + [(x,z) for x,z in reversed(L[:-1])]
def awin(m, w, h, col=LIT, fr=STN2, glow=1, rect=False):
    # a window on a wall: m puts its sill centre on the wall face, the wall facing local -Y
    k.push(m)
    A = [(-w/2,0.0),(w/2,0.0),(w/2,h),(-w/2,h)] if rect else arch(w/2, h*0.6, h, 2); g = 0.12*w+0.1
    k.prism([(x*(1+2*g/w), -g if z == 0 else z+g*0.9) for x,z in A], 0.36, col=fr)
    k.poly([(x,-0.25,z) for x,z in A], col, glow=glow)
    if glow:
        k.poly([(-0.035*w-0.02,-0.31,0),(0.035*w+0.02,-0.31,0),(0.035*w+0.02,-0.31,h*0.95),(-0.035*w-0.02,-0.31,h*0.95)], fr)
        k.poly([(-w/2,-0.31,h*0.5),(w/2,-0.31,h*0.5),(w/2,-0.31,h*0.5+0.06*w+0.03),(-w/2,-0.31,h*0.5+0.06*w+0.03)], fr)
    k.pop()
# ---- the crag: rock with turf on top, boulders round its foot, a stone terrace
def crag(r, at, sc, sub=2, amp=0.28):
    fs = k.rock(r,at,ROCK,sub=sub,sc=sc,amp=amp,nsc=1.0,fj=0.1)
    k.tint(fs, lambda c,n: GRASS if (n.z > 0.82 and c.z > 1.5) else (ROCK2 if n.z < 0.3 else None))
crag(1.0,(0,0,0.2),(9.4,9.6,2.5),3,0.22)
for (a,d,rr,hz) in ((0.3,8.2,2.6,0.6),(1.2,8.6,2.1,0.2),(2.1,8.0,3.0,0.9),(3.0,8.8,2.2,0.3),(3.9,8.1,2.7,0.5),(4.6,8.9,2.0,0.2),(5.3,8.3,2.8,0.7),(5.9,8.8,1.9,0.2)):
    crag(rr,(d*cos(a),d*sin(a),hz),(1.25,1.1,1.0),1,0.3)
TER = [(-7.0,-1.5),(-5.4,-4.2),(-1.0,-4.8),(8.3,-4.8),(8.6,1.9),(2.6,2.5),(1.4,4.6),(-2.4,5.4),(-6.0,4.0)]
k.slab(TER,1.3,Z0,col=STN,fj=0.07,bev=0.12)
# ---- the tower: red and white bands, a stone plinth, a doorcase, lit windows
RB=3.7; RT=2.6; ZT=20.4; NB=10
rz = lambda z: RT+(RB-RT)*(1-(z-Z0)/(ZT-Z0))**1.5
MT = T(TX,TY,0)@RZ(pi/16)
k.lathe([(rz(Z0+(ZT-Z0)*i/NB),Z0+(ZT-Z0)*i/NB) for i in range(NB+1)],16,m=MT,col=WHT,cols=[WHT,WHT,RED,RED,WHT,WHT,RED,RED,WHT,WHT],smooth=True)
k.lathe([(RB+0.55,Z0-0.1),(RB+0.55,Z0+0.7),(RB+0.2,Z0+1.05),(RB-0.1,Z0+1.05)],16,m=MT,col=STN2,fj=0.08)
DY = TY-RB-0.15
k.box(2.4,1.3,3.5,(TX,DY,Z0),STN,bev=0.12,fj=0.05); k.prism([(-1.45,0),(1.45,0),(0,0.95)],1.45,at=(TX,DY,Z0+3.5),col=RED2)
k.poly([(x+TX,DY-0.72,z+Z0+0.1) for x,z in arch(0.7,1.9,2.8)],TEAL); k.box(0.1,0.08,0.1,(TX+0.42,DY-0.75,Z0+1.3),'#f5c021')
k.box(2.6,0.8,0.22,(TX,DY-0.95,Z0-0.1),STN2)
for z in (8.4,12.4,16.4): awin(T(TX,TY-rz(z)*cos(pi/16)-0.02,z),0.9,1.9)
awin(T(TX+rz(10.4)*cos(pi/16)+0.02,TY,10.4)@RZ(pi/2),0.8,1.7); awin(T(TX-rz(14.4)*cos(pi/16)-0.02,TY,14.4)@RZ(-pi/2),0.8,1.7); awin(T(TX,TY+rz(10.4)*cos(pi/16)+0.02,10.4)@RZ(pi),0.8,1.7)
# ---- gallery and rail, the lamp room, the cap
ZG = ZT
k.lathe([(RT,ZG-1.3),(RT+0.25,ZG-1.2),(3.95,ZG-0.15),(3.95,ZG+0.15),(0,ZG+0.15)],16,m=MT,col=DK,cols=[RED2,DK,STN2,STN],fj=0.04)
RP = [(TX+3.8*cos(i*pi/8+pi/16),TY+3.8*sin(i*pi/8+pi/16)) for i in range(16)]
for (x,y) in RP: k.strut((x,y,ZG+0.15),(x,y,ZG+1.25),0.05,DK,seg=3)
k.tube([(x,y,ZG+0.7) for x,y in RP],0.04,col=DK,seg=3,closed=True); k.tube([(x,y,ZG+1.25) for x,y in RP],0.06,col=RED,seg=3,closed=True)
ZL = ZG+0.15; RL = 2.3
k.lathe([(RL,ZL),(RL,ZL+0.8)],16,m=MT,col=WHT,fj=0.02)
fs = k.lathe([(RL-0.08,ZL+0.8),(RL-0.08,ZL+2.9)],8,m=T(TX,TY,0)@RZ(pi/8),col=LIT,glow=1)
k.tint(fs, lambda c,n: ('#fff6cf',1) if n.y < -0.6 else (('#ffd04a',1) if n.y > 0.6 else None))
for i in range(8):
    a = i*pi/4+pi/8; k.strut((TX+RL*cos(a),TY+RL*sin(a),ZL+0.8),(TX+RL*cos(a),TY+RL*sin(a),ZL+2.9),0.07,DK,seg=4)
k.lathe([(RL+0.1,ZL+1.8),(RL+0.1,ZL+1.92)],8,m=T(TX,TY,0)@RZ(pi/8),col=DK)
ZR = ZL+3.15
k.lathe([(RL+0.14,ZR-0.25),(RL+0.14,ZR)],16,m=MT,col=DK)
k.lathe([(RL+0.5,ZR-0.05),(RL+0.32,ZR+0.16),(RL*0.76,ZR+1.15),(RL*0.3,ZR+1.9),(0.22,ZR+2.15),(0,ZR+2.15)],16,m=MT,col=RED,cols=[RED2,RED,RED,RED2,RED2],smooth=True)
k.lathe([(0,ZR+2.05),(0.38,ZR+2.28),(0.38,ZR+2.62),(0,ZR+2.85)],6,at=(TX,TY,0),col=RED2)
k.strut((TX,TY,ZR+2.8),(TX,TY,ZR+4.3),0.05,DK,seg=4); k.box(1.2,0.06,0.06,(TX,TY,ZR+3.55),DK)
k.poly([(TX+0.6,TY,ZR+3.58),(TX+0.95,TY,ZR+3.85),(TX+0.95,TY,ZR+3.31)],DK); k.poly([(TX-0.6,TY,ZR+3.58),(TX-0.9,TY,ZR+3.8),(TX-0.72,TY,ZR+3.58),(TX-0.9,TY,ZR+3.36)],DK)
# ---- the keeper's cottage
CX=4.8; CY=-1.2; CW=5.6; CD=4.4; CH=3.0
k.box(CW,CD,CH,(CX,CY,Z0),WHT,fj=0.02); k.box(CW+0.16,CD+0.16,0.6,(CX,CY,Z0),STN2,fj=0.08)
k.prism([(-CD/2,0),(CD/2,0),(0,2.1)],CW,at=(CX,CY,Z0+CH),col=WHT,rz=pi/2)
k.prism([(-CD/2-0.5,-0.35),(0,2.15),(CD/2+0.5,-0.35),(CD/2+0.5,0.0),(0,2.6),(-CD/2-0.5,0.0)],CW+0.8,at=(CX,CY,Z0+CH),col=RED,rz=pi/2,fj=0.06)
k.box(CW+1.0,0.3,0.24,(CX,CY,Z0+CH+2.5),RED2)
k.box(0.85,0.85,2.6,(CX+1.7,CY+0.7,Z0+CH+0.8),STN,fj=0.1); k.box(1.05,1.05,0.22,(CX+1.7,CY+0.7,Z0+CH+3.4),STN2); k.box(0.5,0.5,0.3,(CX+1.7,CY+0.7,Z0+CH+3.6),DK)
FY = CY-CD/2
k.box(1.25,0.2,2.25,(CX-1.5,FY-0.02,Z0),STN2); k.poly([(CX-1.95,FY-0.14,Z0+0.05),(CX-1.05,FY-0.14,Z0+0.05),(CX-1.05,FY-0.14,Z0+2.05),(CX-1.95,FY-0.14,Z0+2.05)],TEAL)
k.box(0.09,0.08,0.09,(CX-1.2,FY-0.17,Z0+1.05),'#f5c021'); k.box(1.5,0.7,0.2,(CX-1.5,FY-0.4,Z0-0.08),STN2)
k.box(0.22,0.22,0.3,(CX-0.6,FY-0.2,Z0+2.0),'#ffb347',glow=1); k.box(0.3,0.3,0.07,(CX-0.6,FY-0.2,Z0+2.3),DK)
awin(T(CX+0.75,FY,Z0+1.0),1.1,1.3,fr=TEAL,rect=True); awin(T(CX+2.15,FY,Z0+1.0),1.1,1.3,fr=TEAL,rect=True)
awin(T(CX+CW/2,CY,Z0+1.0)@RZ(pi/2),1.1,1.3,fr=TEAL,rect=True); awin(T(CX+0.6,CY+CD/2,Z0+1.0)@RZ(pi),1.1,1.3,fr=TEAL,rect=True)
k.cyl(0.42,0.14,(CX+CW/2+0.0,CY,Z0+CH+0.75),LIT,seg=8,m=RY(pi/2),glow=1)
k.box(2.0,2.2,2.5,(1.6,-0.4,Z0),WHT); k.box(2.2,2.4,0.2,(1.6,-0.4,Z0+2.5),RED2)
# ---- picket fence, steps down the rock, a flagpole
for (x0,x1) in ((-0.2,2.5),(4.2,8.1)):
    n = int((x1-x0)/0.6)
    for j in range(n+1): k.box(0.12,0.08,0.95,(x0+(x1-x0)*j/n,-4.5,Z0),WHT,top=(0.2,1))
    for z in (0.3,0.68): k.box(x1-x0,0.06,0.09,((x0+x1)/2,-4.47,Z0+z),WHT)
for i in range(6): k.box(1.6,0.62,0.34,(3.35,-4.95-0.5*i,Z0-0.32*(i+1)),STN if i%2 else STN2)
k.strut((7.8,1.2,Z0),(7.8,1.2,Z0+7.6),0.07,WHT,seg=5); k.lathe([(0,Z0+7.5),(0.14,Z0+7.65),(0,Z0+7.8)],5,at=(7.8,1.2,0),col='#f5c021')
k.poly([(7.8,1.2,Z0+7.4),(8.7,1.35,Z0+7.3),(9.6,1.2,Z0+7.2),(9.6,1.2,Z0+6.3),(8.7,1.35,Z0+6.25),(7.8,1.2,Z0+6.3)],RED)
for (x,y,r) in ((-5.2,-0.2,0.8),(6.6,-3.6,0.7),(1.6,3.0,0.9),(-3.9,3.8,0.7)): k.rock(r,(x,y,Z0+0.2),'#4a9a38',sub=1,sc=(1.2,1.1,0.75),fj=0.12)
R = k.done()
