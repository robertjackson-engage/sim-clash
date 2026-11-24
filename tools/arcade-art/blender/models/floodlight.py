k = Kit('floodlight', 13)
ST='#5b6680'
k.box(3.6,3.6,1.2,(0,0,-0.7),'#9aa0ad',top=0.85)
leg=lambda t: 1.3-0.8*t
H=26.0; B=9
C=[(-1,-1),(1,-1),(1,1),(-1,1)]
for (a,b) in C:
    k.strut((a*leg(0),b*leg(0),0.5),(a*leg(1),b*leg(1),0.5+H),0.12,ST,seg=4)
for i in range(B):
    t0=i/B; t1=(i+1)/B; z0=0.5+H*t0; z1=0.5+H*t1; w0=leg(t0); w1=leg(t1)
    for j in range(4):
        a=C[j]; b=C[(j+1)%4]
        k.strut((a[0]*w1,a[1]*w1,z1),(b[0]*w1,b[1]*w1,z1),0.06,ST,seg=3)
        p,q=(a,b) if (i+j)%2 else (b,a)
        k.strut((p[0]*w0,p[1]*w0,z0),(q[0]*w1,q[1]*w1,z1),0.05,ST,seg=3)
k.box(2.6,2.6,0.15,(0,0,26.5),'#6f7a8c')
for (a,b) in C: k.strut((a*1.25,b*1.25,26.6),(a*1.25,b*1.25,27.6),0.04,ST,seg=3)
for j in range(4):
    a=C[j]; b=C[(j+1)%4]
    k.strut((a[0]*1.25,a[1]*1.25,27.6),(b[0]*1.25,b[1]*1.25,27.6),0.04,ST,seg=3)
k.strut((-0.25,1.36,0.5),(-0.25,0.62,26.5),0.035,'#ffd21f',seg=3); k.strut((0.25,1.36,0.5),(0.25,0.62,26.5),0.035,'#ffd21f',seg=3)
for j in range(22):
    t=(j+0.5)/22; y=1.36-0.74*t
    k.strut((-0.25,y,0.5+26*t),(0.25,y,0.5+26*t),0.03,'#ffd21f',seg=3)
k.push(T(0,-0.5,26.6) @ RX(radians(14)))
for sx in (-1,1): k.box(0.2,0.2,5.6,(sx*1.3,0.15,0),ST)
for r in range(5):
    z=0.6+r*1.12
    k.box(7.6,0.16,0.16,(0,0.15,z-0.08),ST)
    for c in range(6):
        x=-3.1+c*1.24
        k.cyl(0.5,0.55,(x,0.1,z),'#2a3040',seg=8,m=RX(pi/2),cap=False)
        k.poly([(x+0.44*cos(2*pi*q/8),-0.4,z+0.44*sin(2*pi*q/8)) for q in range(8)],'#fff7cf',glow=1)
k.box(7.9,0.5,0.14,(0,-0.1,5.75),'#3b4252')
k.pop()
k.strut((0,0.4,26.6),(0,0.9,31.0),0.1,ST); k.strut((0,0.9,31.0),(0,-0.2,31.9),0.08,ST,cap=True)
k.sph(0.22,(0,0.9,32.1-0.3),'#ff3d3d',sub=1,glow=1)
k.box(0.9,0.6,1.3,(1.9,0,0.5),'#6f7a8c'); k.box(0.7,0.05,0.5,(1.9,-0.31,1.0),'#ffd21f')
R = k.done()
