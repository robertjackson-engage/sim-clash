k = Kit('launch-ramp', 97)
L=18.0; HW=3.6
zf=lambda y: 0.3+7.2*((L/2-y)/L)**2.2
ys=[L/2-L*i/12 for i in range(13)]
k.box(9.6,L+2.4,1.0,(0,0,-0.8),'#3a3f4a')
fs=k.sheet(lambda u,v:(-HW+2*HW*u, L/2-L*v, zf(L/2-L*v)),6,12,'#2a2d36')
def pa(c,n):
    row=int((L/2-c.y)/(L/12)); col=int((c.x+HW)/(2*HW/6))
    if col in (0,5): return '#e8372c' if row%2 else '#f4f4ee'
    if row%3==1 and col in (2,3): return ('#ffd21f',1)
    if row%3==2 and col in (1,4): return ('#ffd21f',1)
    return None
k.tint(fs,pa)
prof=[(y,zf(y)) for y in ys]+[(-L/2,-0.3),(L/2,-0.3)]
LC=['#ff3da6','#35d0ff','#ffd21f']
for sx in (-1,1):
    k.prism(prof,0.5,at=(sx*(HW+0.25),0,0),col='#d8322a',rz=pi/2)
    k.sheet(lambda u,v:(sx*(HW+0.52), L/2-L*u, zf(L/2-L*u)-0.3-0.55*v),12,1,'#f4f4ee')
    for i in range(12):
        y=L/2-L*(i+0.5)/12
        k.box(0.36,0.7,0.34,(sx*(HW+0.25),y,zf(y)+0.02),LC[i%3],glow=1)
    for i in range(1,5):
        y=L/2-L*(i*2.6+0.2)/12
        if zf(y)>1.6: k.box(0.2,0.5,zf(y)-0.9,(sx*(HW+0.56),y,-0.3),'#7d1f1a')
    k.push(T(sx*5.1,-4.6,3.4)@RX(radians(40)))
    k.cyl(0.85,5.4,(0,0,0),'#f4f4ee',seg=10,smooth=True); k.cyl(0.88,0.6,(0,0,3.6),'#d8322a',seg=10); k.cyl(0.88,0.35,(0,0,1.0),'#22283a',seg=10)
    k.cyl(0.85,1.7,(0,0,5.4),'#d8322a',seg=10,r2=0,smooth=True)
    for f in range(3): k.box(0.12,1.0,1.5,(0,0,0),'#2f7fe8',m=RZ(f*2*pi/3+0.5)@T(0,1.1,-0.1),top=(1,0.4))
    k.cyl(0.6,0.5,(0,0,0),'#3b4252',seg=8,r2=0.75,m=RX(pi))
    k.cyl(0.62,2.4,(0,0,-0.45),'#ff7a1a',seg=6,r2=0,m=RX(pi),glow=1); k.cyl(0.36,1.5,(0,0,-0.45),'#ffe04a',seg=5,r2=0,m=RX(pi),glow=1)
    k.pop()
    k.box(1.3,0.4,0.4,(sx*4.4,-5.6,5.0),'#3b4252'); k.box(1.3,0.4,0.4,(sx*4.4,-3.6,3.4),'#3b4252')
    k.strut((sx*(HW+0.25),-L/2,zf(-L/2)),(sx*(HW+0.25),-L/2,zf(-L/2)+1.1),0.05,'#f4f4ee'); k.poly([(sx*(HW+0.25),-L/2,zf(-L/2)+1.1),(sx*(HW+0.25)+sx*0.9,-L/2,zf(-L/2)+0.9),(sx*(HW+0.25),-L/2,zf(-L/2)+0.6)],'#ffd21f')
k.poly([(-HW,-L/2,-0.3),(HW,-L/2,-0.3),(HW,-L/2,zf(-L/2)),(-HW,-L/2,zf(-L/2))],'#22283a')
for j in range(3):
    z=1.2+j*1.9
    k.poly([(-2.2,-L/2-0.04,z),(0,-L/2-0.04,z+1.1),(2.2,-L/2-0.04,z),(2.2,-L/2-0.04,z+0.7),(0,-L/2-0.04,z+1.8),(-2.2,-L/2-0.04,z+0.7)],'#35d0ff' if j%2 else '#ff3da6',glow=1)
k.box(0.3,0.3,3.4,(4.9,9.4,0.2),'#3b4252'); k.box(0.7,0.5,2.0,(4.9,9.4,3.0),'#22283a')
for j,c in enumerate(('#3dff6a','#ffd21f','#ff3d3d')): k.sph(0.24,(4.9,9.1,3.35+j*0.62),c,sub=1,glow=1)
for (x,y) in ((-5.0,9.2),(-5.6,7.9),(-4.6,10.2)):
    for j in range(3): k.cyl(0.55,0.36,(x,y,0.2+j*0.38),'#22232a' if j%2 else '#2f3038',seg=8)
R = k.done()
