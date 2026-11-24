k = Kit('castle', 63)
ST='#e0d6bc'; ST2='#c2b698'; BLUE='#2f6fd8'; RED='#d8322a'; DK='#2a2622'
k.box(44,44,1.8,(0,0,-1.5),'#a9a294',top=0.94,fj=0.06)
HW=16.0; WH=9.0
for q in range(4):
    k.push(RZ(q*pi/2))
    k.box(2*HW,2.4,WH,(0,-HW,0.2),ST2)
    k.sheet(lambda u,v:(-HW+2*HW*u,-HW-1.22,0.2+WH*v),14,5,ST,fj=0.09)
    k.box(2*HW,3.0,0.5,(0,-HW,0.2+WH-0.2),ST2)
    for j in range(13):
        x=-HW+1.3+j*2.45
        if q==0 and abs(x)<5: continue
        k.box(1.3,3.0,1.2,(x,-HW,0.5+WH),ST)
    if q>0:
        for x in (-8,0,8): k.poly([(x-0.25,-HW-1.25,4.5),(x+0.25,-HW-1.25,4.5),(x+0.25,-HW-1.25,6.6),(x-0.25,-HW-1.25,6.6)],DK)
    k.pop()
def rtower(x,y,r,h,roofc,seg=12,z0=0.0,flag=RED,fl=True):
    k.lathe([(r*1.1,z0),(r,z0+1.5),(r,z0+h*0.5),(r,z0+h),(r*1.22,z0+h+0.9),(r*1.22,z0+h+1.6),(r*0.9,z0+h+1.6)],seg,col=ST,at=(x,y,0),fj=0.09)
    for j in range(8):
        a=j*pi/4
        k.box(r*0.5,r*0.3,r*0.36,(0,0,0),ST2,m=T(x,y,z0+h+1.6)@RZ(a)@T(0,-r*1.07,0))
    k.lathe([(r*1.32,z0+h+1.5),(r*0.72,z0+h+1.5+r*1.2),(0,z0+h+1.5+r*3.1)],seg,col=roofc,at=(x,y,0),fj=0.1)
    zt=z0+h+1.5+r*3.1
    k.sph(r*0.12,(x,y,zt),'#f5c021',sub=1)
    if fl:
        k.strut((x,y,zt),(x,y,zt+r*0.9),0.05,'#f4f4ee'); k.poly([(x,y,zt+r*0.9),(x+r*0.7,y,zt+r*0.75),(x,y,zt+r*0.55)],flag)
    for a in (0,pi/2,pi,3*pi/2):
        k.push(T(x,y,0)@RZ(a+0.3))
        zz=z0+h*0.62
        k.poly([(-0.3,-r-0.04,zz),(0.3,-r-0.04,zz),(0.3,-r-0.04,zz+1.3),(0,-r-0.04,zz+1.7),(-0.3,-r-0.04,zz+1.3)],'#ffd76a',glow=1)
        k.pop()
for (sx,sy) in ((-1,-1),(1,-1),(1,1),(-1,1)): rtower(sx*HW,sy*HW,3.3,12.5,BLUE)
k.box(10,5.5,12.5,(0,-HW,0.2),ST,fj=0.05)
k.box(11,6.3,0.6,(0,-HW,12.4),ST2)
for j in range(5): k.box(1.2,6.3,1.1,(-4.6+j*2.3,-HW,13.0),ST)
arch=[(2.3*cos(pi-i*pi/8),5.0+2.3*sin(pi-i*pi/8)) for i in range(9)]
k.prism([(-2.3,0.2)]+arch+[(2.3,0.2)],0.6,at=(0,-HW-2.6,0),col=DK)
for j in range(5): k.strut((-1.8+j*0.9,-HW-2.95,0.3),(-1.8+j*0.9,-HW-2.95,6.6 if abs(j-2)<2 else 5.6),0.08,'#6f7a8c',seg=4)
for z in (1.8,3.6,5.2): k.strut((-2.2,-HW-2.95,z),(2.2,-HW-2.95,z),0.07,'#6f7a8c',seg=4)
k.box(4.8,8.0,0.35,(0,-HW-6.6,0.0),'#8a5530',m=RX(0.04)); 
for sx in (-1,1):
    rtower(sx*5.6,-HW-1.6,1.9,13.5,RED,seg=10,flag=BLUE)
    k.strut((sx*2.3,-HW-10.4,0.5),(sx*2.6,-HW-2.9,8.6),0.06,'#3b4252',seg=3)
    fs=k.sheet(lambda u,v:(sx*3.6-0.9+1.8*u,-HW-2.8-0.1*sin(v*5),11.5-4.2*v+(0.5*abs(2*u-1)-0.5)*(v>0.9)),2,5,RED)
    k.sph(0.5,(sx*3.6,-HW-2.95,9.8),'#f5c021',sub=1,sc=(1,0.2,1))
k.box(14,14,17.5,(0,2,0.2),ST2)
for q in range(4):
    k.push(T(0,2,0)@RZ(q*pi/2)); k.sheet(lambda u,v:(-7+14*u,-7.03,0.2+17.5*v),8,9,ST,fj=0.09); k.pop()
boxwin(k,0,2,14,14,9.5,16.5,2,3,3,lit=0.75,cl=('#ffd76a','#ffe9a0'),cd=DK,fw=0.28,fhh=0.6)
k.box(15.4,15.4,0.7,(0,2,17.5),ST2)
for q in range(4):
    k.push(T(0,2,0)@RZ(q*pi/2))
    for j in range(6): k.box(1.3,0.9,1.2,(-6.0+j*2.4,-7.2,18.2),ST)
    k.pop()
for (sx,sy) in ((-1,-1),(1,-1),(1,1),(-1,1)): rtower(sx*7.0,2+sy*7.0,1.9,8.0,BLUE,seg=10,z0=12.0)
k.lathe([(1.0,12.0-2.2),(1.9,12.0)],10,col=ST2,at=(-7,-5,0)); k.lathe([(1.0,9.8),(1.9,12.0)],10,col=ST2,at=(7,-5,0)); k.lathe([(1.0,9.8),(1.9,12.0)],10,col=ST2,at=(-7,9,0)); k.lathe([(1.0,9.8),(1.9,12.0)],10,col=ST2,at=(7,9,0))
rtower(0,2,4.0,7.5,RED,seg=14,z0=18.0)
for i in range(5):
    a=i*1.3; k.rock(1.6+k.rnd.random(),(10*cos(a)*0.9,2+10*sin(a)*0.9 if abs(sin(a))>0.5 else 11,2.2),'#3fae3a',sub=1,sc=(1,1,1.1),fj=0.12)
R = k.done()
