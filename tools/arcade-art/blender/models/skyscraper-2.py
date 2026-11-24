k = Kit('skyscraper-2', 73)
GL=['#17899f','#1c9db5','#147688']
k.box(36,36,2.2,(0,0,-1.6),'#3a3f4a'); k.box(30,30,5.0,(0,0,0.6),'#22283a')
for q in range(4):
    k.push(RZ(q*pi/2)); k.poly([(-11,-15.05,1.2),(11,-15.05,1.2),(11,-15.05,4.6),(-11,-15.05,4.6)],'#8fe3ff',glow=1); k.pop()
NV=30; NU=16; H=104.0; Z0=5.6
def P(u,v):
    a=2*pi*u; tw=v*1.15; R=13.5-4.5*v**1.4
    se=(abs(cos(a))**4+abs(sin(a))**4)**(-0.25)
    return (R*se*cos(a+tw), R*se*sin(a+tw), Z0+H*v+ (7.0*(0.5+0.5*cos(a+tw-0.6)) if v>=0.999 else 0))
fs=k.sheet(P,NU,NV,GL[0])
def paint(c,n):
    row=int((c.z-Z0)/(H/NV))
    if row%6==5: return ('#5df2ff',1)
    r=k.rnd.random()
    if r<0.3: return (k.rnd.choice(('#ffe9a0','#fff4c2','#b8f3ff')),1)
    return GL[k.rnd.randint(0,2)]
k.tint(fs,paint)
for q in range(4):
    pts=[P(q/4+0.125,v/10) for v in range(11)]
    k.tube([(p[0]*1.03,p[1]*1.03,p[2]) for p in pts],0.5,col='#ff3da6',seg=3,glow=1)
k.poly([P(u/NU,1.0) for u in range(NU)],'#22283a')
k.cyl(5.0,0.5,(0,0,Z0+H+3.0),'#56607a',seg=10); k.cyl(3.4,0.12,(0,0,Z0+H+3.5),'#ffd21f',seg=10,glow=1)
k.strut((2.5,0,Z0+H+3),(3.5,0,Z0+H+13.5),0.3,'#f4f4ee',seg=5,cap=True); k.sph(0.8,(3.5,0,Z0+H+13.8),'#ff3d3d',sub=1,glow=1)
R = k.done()
