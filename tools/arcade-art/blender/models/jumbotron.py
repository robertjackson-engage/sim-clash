k = Kit('jumbotron', 11)
ST='#4a5470'; DK='#20232b'
for sx in (-1,1):
    cx=sx*6.9
    k.box(3.0,3.0,1.1,(cx,0.4,-0.6),'#9aa0ad',top=0.9)
    L=[(cx+a*0.8, 0.4+b*0.8) for a in (-1,1) for b in (-1,1)]
    for (x,y) in L: k.box(0.24,0.24,16.6,(x,y,0.5),ST)
    for b in range(8):
        z0=0.5+b*2.05; z1=z0+2.05
        for (p,q) in ((0,1),(2,3),(0,2),(1,3)):
            a=L[p]; c=L[q]
            k.strut((a[0],a[1],z1),(c[0],c[1],z1),0.07,ST,seg=3)
            if b%2: a,c=c,a
            k.strut((a[0],a[1],z0),(c[0],c[1],z1),0.06,ST,seg=3)
    k.cyl(0.3,0.5,(cx,0.4,17.1),'#ff3d3d',seg=6,glow=1)
k.box(15.8,1.3,7.9,(0,-0.9,8.0),DK)
X0=-7.2; ZB=8.5; CW=0.45; CH=0.43125
def pix(c,r):
    if r<4: return '#39d657' if ((c//2)+(r//2))%2 else '#27b845'
    if c==23 and 4<=r<=14: return '#ffffff'
    if 24<=c<=28 and 10<=r<=14 and (c-24)<=4-2*abs(r-12): return '#ff2b2b'
    d=(c-10.5)**2+(r-10)**2
    if d<=7.5: return '#ffffff' if (c-11.3)**2+(r-10.8)**2<4.5 else '#cfd6e2'
    if c<9 and abs((r-10)-(c-10.5)*0.5)<1.2-0.09*(9-c): return '#ffd21f' if c>4 else '#ff8a1f'
    return mix('#1f8fff','#8fe3ff',(r-4)/12)
for c in range(32):
    for r in range(16):
        x=X0+c*CW; z=ZB+r*CH
        k.poly([(x,-1.57,z),(x+CW,-1.57,z),(x+CW,-1.57,z+CH),(x,-1.57,z+CH)],pix(c,r),glow=1)
for (bx,bz,sx,sz) in ((0,8.2,15.2,0.3),(0,15.4,15.2,0.3),(-7.4,8.2,0.3,7.5),(7.4,8.2,0.3,7.5)):
    k.box(sx,0.25,sz,(bx,-1.6,bz),'#e8372c')
k.box(9.0,0.6,1.5,(0,-0.9,15.9),'#ffd21f')
k.box(9.4,0.7,0.25,(0,-0.9,17.4),'#e8372c')
for j in range(5):
    k.cyl(0.42,0.1,(-3.2+j*1.6,-1.2,16.65),'#ffffff' if j%2==0 else '#ff3d3d',seg=8,m=RX(pi/2),glow=1)
for j in range(6):
    x=-6.8+j*2.72
    k.cyl(0.38,0.6,(x,-1.0,16.25) if abs(x)>4.8 else (x,-1.0,17.75),'#2a3040',seg=8,m=RX(radians(70)),cap=False)
    k.cyl(0.34,0.05,(x,-1.5,16.42) if abs(x)>4.8 else (x,-1.5,17.92),'#fff4c2',seg=8,m=RX(radians(70)),glow=1)
k.box(15.8,0.5,1.0,(0,-1.1,6.85),DK)
TK=['#ff8a1f','#ffd21f','#ff8a1f',None]
for j in range(28):
    c=TK[j%4]
    if c:
        x=-7.56+j*0.54
        k.poly([(x,-1.37,7.05),(x+0.46,-1.37,7.05),(x+0.46,-1.37,7.65),(x,-1.37,7.65)],c,glow=1)
for sx in (-1,1):
    for q in range(6):
        k.box(1.0,0.9,0.62,(sx*8.75,-0.9-0.05*q*q*0.2,14.6-q*0.68),'#2a2d36',m=RX(radians(-3*q)))
        k.box(0.8,0.06,0.42,(sx*8.75,-1.38-0.05*q*q*0.2,14.7-q*0.68),'#7d8596',m=RX(radians(-3*q)))
    k.strut((sx*7.9,0.0,15.6),(sx*8.75,-0.9,15.3),0.07,ST)
for z in (8.0,12.0):
    k.box(14.6,1.0,0.12,(0,1.75,z),'#6f7a8c')
    for j in range(9): k.strut((-7.2+j*1.8,2.2,z),(-7.2+j*1.8,2.2,z+1.05),0.04,ST,seg=3)
    k.strut((-7.2,2.2,z+1.05),(7.2,2.2,z+1.05),0.04,ST,seg=3)
for j in range(7): k.box(15.0,0.12,0.5,(0,-0.22,8.5+j*1.05),'#343a4a')
for z in (3.0,6.0):
    k.strut((-6.1,0.4,z),(6.1,0.4,z),0.12,ST); 
for j in range(6):
    xa=-6.1+j*2.03; xb=xa+2.03
    k.strut((xa,0.4,3.0),(xb,0.4,6.0),0.07,ST,seg=3) if j%2==0 else k.strut((xa,0.4,6.0),(xb,0.4,3.0),0.07,ST,seg=3)
R = k.done()
