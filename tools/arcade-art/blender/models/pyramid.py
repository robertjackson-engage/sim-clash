k = Kit('pyramid', 59)
SA=['#e8c878','#dcb964','#f0d48c']; GOLD='#ffcf33'; NC=16; CH=2.75; HB=46.0
k.box(2*HB+10,2*HB+10,1.6,(0,0,-1.6),'#d9b56a',top=0.96)
for i in range(NC):
    w0=HB-i*2.2; z=i*CH; nb=max(3,int(round(w0/2.3)))
    for q in range(4):
        k.push(RZ(q*pi/2))
        k.sheet(lambda u,v:(-w0+2*w0*u,-w0+0.3*v,z+CH*v),nb,1,SA[i%3],fj=0.1)
        k.poly([(-w0,-w0+0.3,z+CH),(w0,-w0+0.3,z+CH),(w0-2.2,-w0+2.2,z+CH),(-w0+2.2,-w0+2.2,z+CH)],'#f6e2a6')
        k.pop()
zc=NC*CH; wc=HB-NC*2.2
k.box(2*wc+0.6,2*wc+0.6,0.7,(0,0,zc),'#2f6fd8')
k.box(2*wc,2*wc,12.6,(0,0,zc+0.7),'#fbf5e4',top=0.18)
k.box(2*wc*0.18,2*wc*0.18,2.9,(0,0,zc+13.3),GOLD,top=0,glow=1)
yf=-(HB-3*2.2)
for j in range(9):
    y=-HB-13.0+j*1.75
    k.box(7.0,yf-y+1.0,0.92,(0,(y+yf+1.0)/2,j*0.92),'#f0d48c' if j%2 else '#e2c173')
for sx in (-1,1):
    k.prism([(-HB-14.0,0.0),(yf,8.25),(yf,9.6),(-HB-14.0,1.5)],1.0,at=(sx*4.0,0,0),col='#dcb964',rz=pi/2)
    k.box(2.4,2.4,1.2,(sx*8.0,-HB-10,0),'#dcb964'); k.box(1.7,1.7,11.0,(sx*8.0,-HB-10,1.2),'#f0d48c',top=0.6); k.box(1.02,1.02,1.6,(sx*8.0,-HB-10,12.2),GOLD,top=0,glow=1)
    for e in range(4): k.box(1.1,0.1,0.5,(sx*8.0,-HB-10.9,3+e*2.0),'#2f6fd8' if e%2 else '#e8372c')
k.box(9.0,4.0,7.5,(0,yf+1.2,8.25),'#e2c173',top=(0.85,1))
k.box(3.6,0.5,5.0,(0,yf-0.85,8.25),'#1c1812'); k.box(5.6,0.7,1.1,(0,yf-0.8,13.3),GOLD)
k.poly([(-1.2,yf-1.12,8.4),(1.2,yf-1.12,8.4),(1.2,yf-1.12,12.6),(-1.2,yf-1.12,12.6)],'#ffb347',glow=1)
for sx in (-1,1): k.box(0.9,0.4,5.0,(sx*2.5,yf-0.85,8.25),'#2f6fd8'); k.box(0.5,0.15,0.5,(sx*2.5,yf-1.1,11.5),GOLD)
for i in range(12):
    a=k.rnd.uniform(0,2*pi); r=HB+3+k.rnd.random()*5
    x=r*cos(a)*1.0; y=r*sin(a)
    if abs(x)<12 and y<0: continue
    x=max(-HB-6,min(HB+6,x)); y=max(-HB-6,min(HB+6,y))
    if abs(x)<HB+1 and abs(y)<HB+1: x=(HB+3)*(1 if x>0 else -1)
    k.box(2.4,2.0,1.8,(x,y,-0.3),SA[i%3],m=RZ(a)@RX(k.rnd.uniform(-0.3,0.3)),jit=0.08)
R = k.done()
