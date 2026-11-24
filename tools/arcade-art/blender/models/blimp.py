k = Kit('blimp', 141)
N=14; L=46.0; R=7.4; ZC=10.0
prof=[(max(0.0,R*(sin(pi*(i/N)**0.85)**0.6)) if 0<i<N else 0.0, -L/2+L*i/N) for i in range(N+1)]
fs=k.lathe(prof,16,col='#e9eef5',m=T(0,0,ZC)@RX(pi/2),smooth=True)
def band(c,n):
    if c.y<-L/2+7: return '#2f7fe8'
    if abs(c.z-ZC)<1.6 and abs(c.y)<14 and abs(c.x)>5.5: return None
    if c.z<ZC-3.6: return '#2f7fe8'
    if c.y>L/2-9: return '#e8372c'
    return None
k.tint(fs,band)
for sx in (-1,1):
    for c in range(18):
        for r in range(4):
            col='#ffd21f' if (c in (2,3,4,7,10,11,12,15) and r in (0,3)) or (c in (2,7,9,13,15) and r in (1,2)) or (c==4 and r==1) else ('#ff3da6' if (c+r)%9==0 else '#1a1c2c')
            y=-12.6+c*1.4 if sx<0 else 12.6-c*1.4-1.3
            z=ZC-2.4+r*1.2; x=sx*(sqrt(max(0.1,R*R*0.97-(z+0.6-ZC)**2))+0.12)
            k.poly([(x,y,z),(x,y+1.3,z),(x,y+1.3,z+1.1),(x,y,z+1.1)],col,glow=(col!='#1a1c2c'))
for q in range(4):
    k.push(T(0,0,ZC)@RY(q*pi/2))
    k.prism([(0,0),(6.0,0),(7.6,5.0),(4.6,5.6),(1.2,3.0)],0.4,col='#e8372c',m=T(0,19.6,2.2)@RZ(-pi/2)@T(-6.0,0,0))
    k.pop()
k.box(3.2,9.0,2.6,(0,-2,0.0),'#2f7fe8',bev=0.5); k.box(3.3,7.0,0.9,(0,-2,1.1),'#8fe3ff',glow=1)
k.box(2.0,5.0,0.8,(0,-2,2.6),'#56607a')
for sx in (-1,1):
    k.cyl(0.6,2.0,(sx*2.6,1.5,1.4),'#56607a',seg=8,m=RX(-pi/2),smooth=True)
    for b in range(3): k.box(0.25,0.07,2.2,(sx*2.6,3.6,1.4),'#f4f4ee',m=RY(b*pi/3)@T(0,0,-1.1))
    k.strut((sx*1.5,1.8,1.6),(sx*2.6,2.0,1.4),0.1,'#3b4252')
k.sph(0.5,(0,-L/2-0.2,ZC),'#ff3d3d',sub=1,glow=1)
R = k.done()
