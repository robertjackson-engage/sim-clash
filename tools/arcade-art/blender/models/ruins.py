k = Kit('ruins', 67)
ST='#ddd6c2'; ST2='#b8b09a'; MOSS='#6aaa3f'
k.box(20.5,13.5,1.0,(0,0,-0.7),ST2,fj=0.06); k.box(18.4,11.4,0.5,(0,0,0.3),ST,fj=0.06); k.box(16.6,9.8,0.45,(0,0,0.8),ST2,fj=0.06)
for j in range(8):
    a0=j*pi/4; a1=a0+pi/4
    k.poly([(0,0,1.27),(2.6*cos(a0),2.6*sin(a0),1.27),(2.6*cos(a1),2.6*sin(a1),1.27)],'#19c2b8' if j%2 else '#f5c021')
    k.poly([(2.6*cos(a0),2.6*sin(a0),1.27),(3.3*cos(a0),3.3*sin(a0),1.27),(3.3*cos(a1),3.3*sin(a1),1.27),(2.6*cos(a1),2.6*sin(a1),1.27)],'#e8372c' if j%2 else '#f4f4ee')
def column(x,y,h,full):
    k.cyl(1.0,0.4,(x,y,1.25),ST2,seg=8)
    nd=int(h/1.1)
    for d in range(nd):
        k.cyl(0.72,1.1,(x+k.rnd.uniform(-.05,.05),y+k.rnd.uniform(-.05,.05),1.65+d*1.1),ST,seg=10,r2=0.7,jit=0.08,rz=k.rnd.random())
        k.cyl(0.75,0.08,(x,y,1.65+d*1.1),ST2,seg=10)
    top=1.65+nd*1.1
    if full:
        k.cyl(0.74,0.35,(x,y,top),ST2,seg=10,r2=1.0); k.box(2.1,2.1,0.3,(x,y,top+0.35),ST)
        return top+0.65
    k.cyl(0.7,0.55,(x,y,top),ST,seg=7,r2=0.35,m=RX(k.rnd.uniform(-.25,.25)))
    return top
tops=[column(x,-3.7,h,f) for (x,h,f) in ((-6.2,5.5,True),(-2.1,5.5,True),(2.1,3.3,False),(6.2,1.1,False))]
column(-6.2,3.7,5.5,True); column(-2.1,3.7,2.2,False); t3=column(2.1,3.7,5.5,True); column(6.2,3.7,4.4,False)
zt=tops[0]
k.box(6.6,2.0,0.9,(-4.15,-3.7,zt),ST,fj=0.05)
for j in range(6):
    k.box(0.5,2.1,0.7,(-6.9+j*1.1,-3.7,zt+0.9),'#2f7fe8' if j%2 else ST2)
k.box(6.9,2.3,0.35,(-4.15,-3.7,zt+1.6),ST2)
k.prism([(-3.4,0),(3.4,0),(3.4,0.4),(-0.6,1.9),(-3.4,0.6)],1.8,at=(-4.15,-3.7,zt+1.95),col=ST)
k.box(4.6,1.5,0.9,(-4.3,3.7,3.2),ST,m=RY(0.75)@T(0.6,0,0))
k.box(6.2,1.6,0.9,(4.0,3.3,0.9),ST2,m=RZ(0.25)@RY(-0.08))
for (x,y,a) in ((4.5,-5.2,0.3),(7.3,-2.2,1.2),(8.6,1.0,2.0),(1.0,-6.3,0.1),(-8.9,-0.5,1.6)):
    k.cyl(0.72,1.1,(x,y,0.65+0.5*(abs(x)<8.3 and abs(y)<4.9)),ST,seg=10,m=RZ(a)@RX(pi/2)@T(0,0,-0.55),jit=0.08)
for i in range(11):
    x=k.rnd.uniform(-9.5,9.5); y=k.rnd.uniform(-6.3,6.3)
    zf=1.25 if (abs(x)<8.3 and abs(y)<4.9) else (0.8 if (abs(x)<9.2 and abs(y)<5.7) else 0.3)
    k.box(1.2+k.rnd.random()*0.6,0.9+k.rnd.random()*0.5,0.7+k.rnd.random()*0.4,(x,y,zf-0.1),ST if i%2 else ST2,m=RZ(k.rnd.random()*3)@RX(k.rnd.uniform(-.25,.25)),jit=0.08)
k.box(2.2,2.2,1.5,(0,2.9,1.25),ST2,bev=0.1)
k.lathe([(0.5,2.75),(0.3,3.0),(0.9,3.8),(1.0,4.5),(0.6,4.9),(0.75,5.2),(0.55,5.2)],10,col='#19a8a0',smooth=True)
for i in range(16):
    x=k.rnd.uniform(-9.8,9.8); y=k.rnd.uniform(-6.5,6.5)
    zf=1.25 if (abs(x)<8.3 and abs(y)<4.9) else (0.8 if (abs(x)<9.2 and abs(y)<5.7) else 0.3)
    k.rock(0.6+k.rnd.random()*0.7,(x,y,zf),MOSS,sub=1,sc=(1.3,1.1,0.4),fj=0.14)
for j in range(7):
    x=-7.0+j*0.95; L=1.0+k.rnd.random()*2.2
    k.box(0.35,0.12,L,(x,-4.75,zt+0.9-L),'#4c9a35',top=(0.4,1))
k.rock(0.9,(-6.4,-3.7,zt+2.2),MOSS,sub=1,sc=(1.6,1.2,0.5)); k.rock(0.8,(2.1,3.7,t3+0.1),MOSS,sub=1,sc=(1.4,1.4,0.5))
R = k.done()
