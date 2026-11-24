k = Kit('gate', 23)
S1='#e6dabf'; S2='#c9b994'; GOLD='#f5c021'; ZS=6.0; RI=3.9
for sx in (-1,1):
    cx=sx*5.7
    k.box(4.6,4.6,1.4,(cx,0,-0.6),S2,bev=0.15)
    k.box(3.6,3.6,10.4,(cx,0,0.8),S1)
    for z in (2.4,4.4,6.4,8.4): k.box(3.75,3.75,0.28,(cx,0,z),S2)
    k.box(1.5,0.3,3.4,(cx,-1.75,2.9),'#2f7fe8'); k.box(1.9,0.36,0.3,(cx,-1.75,2.6),GOLD); k.box(1.9,0.36,0.3,(cx,-1.75,6.3),GOLD)
    k.sheet(lambda u,v:(cx-0.55+1.1*u,-1.98-0.08*sin(v*6),6.2-2.9*v+(0.35*abs(2*u-1)-0.35)*(v>0.9)),2,5,'#e8372c')
    k.sph(0.33,(cx,-1.98,5.2),GOLD,sub=1,sc=(1,0.2,1))
    # top of pylon: cap, urn, flag
    k.box(4.3,4.3,0.5,(cx,0,12.3),S2,bev=0.12)
    k.lathe([(0.5,12.8),(0.9,13.2),(0.7,13.7),(0.3,13.8)],8,col=GOLD,at=(cx,0,0),smooth=True)
    flame(k,(cx,0,13.75),0.45,1.2)
    # brazier at the foot
    k.lathe([(0.25,0.0),(0.2,1.1),(0.75,1.5),(0.8,1.6)],8,col='#3b4252',at=(sx*2.9,-3.4,0))
    flame(k,(sx*2.9,-3.4,1.5),0.5,1.3)
    k.box(1.2,1.2,0.5,(sx*2.9,-3.4,-0.4),S2)
    # open iron gate leaf
    k.push(T(sx*RI,-0.6,0)@RZ(sx*radians(-68)))
    for j in range(7):
        x=-sx*(0.3+j*0.5); h=6.4+1.1*sin(j/6*pi*0.5)
        k.strut((x,0,0.2),(x,0,h),0.06,'#20232b',seg=4); k.cyl(0.11,0.4,(x,0,h),GOLD,seg=4,r2=0)
    for z in (0.5,3.2,6.0): k.box(3.4,0.12,0.14,(-sx*1.75,0,z),'#20232b')
    k.pop()
arc=[(RI*cos(pi-i*pi/12), ZS+RI*sin(pi-i*pi/12)) for i in range(13)]
k.prism([(-RI,11.4)]+arc+[(RI,11.4)],2.6,col=S1)
for i in range(13):
    f=-pi/2+(i+0.5)*pi/13; key=(i==6)
    k.box(1.5 if key else 1.12,3.3 if key else 3.0,2.0 if key else 1.45,(0,0,0),GOLD if key else (S2 if i%2 else '#f1e8d2'),m=T(0,0,ZS)@RY(f)@T(0,0,RI-0.02))
k.box(16.2,4.0,0.5,(0,0,11.2),S2,bev=0.12)
k.box(15.2,3.4,1.1,(0,0,11.7),S1)
k.box(16.6,4.2,0.4,(0,0,12.8),S2,bev=0.1)
for j in range(11):
    x=-5.0+j*1.0
    k.cyl(0.3,0.1,(x,-1.72,12.25),'#fff4c2' if j%2 else '#ffb41f',seg=8,m=RX(pi/2),glow=1)
k.box(5.2,1.6,0.9,(0,0,13.2),S1,top=(0.8,0.9))
k.cyl(0.25,0.9,(0,0,14.1),'#e8372c',seg=6,r2=0.5)
fs=k.sph(1.05,(0,0,15.9),'#f4f4ee',sub=2,smooth=True)
for sx in (-1,1):
    k.prism([(0,0),(2.6,0),(2.6,0.5),(0.4,1.5),(0,1.5)],1.2,at=(sx*2.6,0,13.2),col=GOLD,m=S(sx,1,1) if sx>0 else RZ(pi))
    k.strut((sx*7.6,0,13.2),(sx*7.6,0,16.2),0.07,'#f4f4ee'); k.poly([(sx*7.6,0,16.2),(sx*7.6+sx*2.0,0,15.8),(sx*7.6,0,15.3)],'#2f7fe8' if sx>0 else '#e8372c')
R = k.done()
