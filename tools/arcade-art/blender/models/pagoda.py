k = Kit('pagoda', 53)
RED='#d8322a'; ROOF='#1f8a80'; GOLD='#f5c021'; WH='#f4efe0'; DKW='#4a2a1e'
k.box(14,14,1.7,(0,0,-0.9),'#b8a98a',bev=0.15,fj=0.05); k.box(11.6,11.6,0.7,(0,0,0.8),'#cfc3a5')
for i in range(3): k.box(4.2,0.8,0.5,(0,-6.2-0.7*(2-i),-0.2+0.5*i),'#cfc3a5')
def roof(R,z0,h,lift):
    def P(u,v):
        a=2*pi*u+pi/4; sq=1/max(abs(cos(a)),abs(sin(a)))
        r=(0.3+0.7*v**0.85)*R*sq
        return (r*cos(a), r*sin(a), z0+h*(1-v)**1.7+lift*((sq-1)/0.414)**2*v*v)
    fs=k.sheet(P,32,4,ROOF,fj=0.08)
    k.tint(fs, lambda c,n: '#e0a020' if max(abs(c.x),abs(c.y))>R*0.87 else None)
    for q in range(4):
        p=P(q/4,1.0)
        k.strut((p[0],p[1],p[2]),(p[0],p[1],p[2]-0.6),0.03,DKW,seg=3)
        k.sph(0.32,(p[0],p[1],p[2]-0.9),'#ffb347',sub=1,glow=1)
        k.strut(P(q/4,0.0),P(q/4,1.0),0.16,'#e0a020',seg=4)
z=1.5
for i in range(5):
    w=9.4-1.4*i
    k.box(w+1.8,w+1.8,0.28,(0,0,z-0.1),DKW)
    k.box(w,w,3.0,(0,0,z),WH)
    for q in range(4):
        k.push(RZ(q*pi/2))
        for x in (-w/2,-w/6,w/6): k.box(0.45,0.45,3.0,(x,-w/2,z),RED)
        k.box(w+1.8,0.14,0.14,(0,-w/2-0.85,z+0.9),RED); k.box(w+1.8,0.1,0.1,(0,-w/2-0.85,z+0.5),RED)
        for x in (-w/2-0.85,0,w/2+0.85)[:2]: k.box(0.16,0.16,0.95,(x,-w/2-0.85,z),RED)
        for x in (-w/3,w/3):
            k.poly([(x-w/9,-w/2-0.03,z+0.9),(x+w/9,-w/2-0.03,z+0.9),(x+w/9,-w/2-0.03,z+2.4),(x-w/9,-w/2-0.03,z+2.4)],'#ffd98a',glow=1)
            k.box(0.08,0.06,1.5,(x,-w/2-0.05,z+0.9),DKW); k.box(w/4.5,0.06,0.08,(x,-w/2-0.05,z+1.6),DKW)
        if i==0 and q==0: k.box(1.9,0.2,2.5,(0,-w/2-0.05,z),DKW); k.box(1.5,0.1,2.2,(0,-w/2-0.14,z),'#8a2a1e')
        k.pop()
    k.box(w+0.9,w+0.9,0.5,(0,0,z+3.0),RED)
    roof(w/2+2.1,z+3.35,1.5,1.25)
    z+=4.1
k.lathe([(0.9,z-0.9),(0.5,z-0.3),(0.22,z),(0.2,z+2.9),(0,z+3.6)],8,col=GOLD,smooth=True)
for j in range(5): k.cyl(0.75-0.1*j,0.14,(0,0,z+0.3+j*0.5),GOLD,seg=10)
k.sph(0.28,(0,0,z+3.5),GOLD,sub=1)
R = k.done()
