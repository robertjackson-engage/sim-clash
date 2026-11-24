k = Kit('hut', 33)
BAM='#d9b25a'; WOOD='#a0683a'; TH='#d9a94a'
k.cyl(3.5,0.6,(0,0,-0.4),WOOD,seg=12,fj=0.08)
k.cyl(3.7,0.12,(0,0,0.2),'#c98f52',seg=12,fj=0.06)
for j in range(8):
    a=j*pi/4+pi/8
    k.cyl(0.15,2.5,(2.8*sin(a),-2.8*cos(a),0.3),BAM,seg=6)
    for z in (1.0,1.8): k.cyl(0.17,0.08,(2.8*sin(a),-2.8*cos(a),z),'#a0803a',seg=6)
fs=k.sheet(lambda u,v:(2.85*sin(0.55+u*(2*pi-1.1)),-2.85*cos(0.55+u*(2*pi-1.1)),0.3+1.15*v),28,1,BAM,fj=0.14)
k.sheet(lambda u,v:((2.9+0.12*v)*sin(0.5+u*(2*pi-1.0)),-(2.9+0.12*v)*cos(0.5+u*(2*pi-1.0)),1.45+0.1*v),14,1,WOOD)
k.box(2.5,0.7,1.05,(0,-2.7,0.3),'#8a5530',fj=0.06); k.box(2.9,1.0,0.12,(0,-2.75,1.35),'#c98f52')
for x in (-0.9,0,0.9):
    k.cyl(0.25,0.1,(x,-3.7,0.95),'#e8372c',seg=8); k.cyl(0.05,0.75,(x,-3.7,0.2),'#3b4252',seg=4)
for (i,(c,x)) in enumerate((('#19c2b8',-0.6),('#ff5fa8',0.1),('#ffd21f',0.7))):
    k.cyl(0.11,0.34,(x,-2.75,1.47),c,seg=6,r2=0.14)
def thatch(R,z0,r1,z1,n=22):
    return k.sheet(lambda u,v:((R+(r1-R)*v)*(1+0.07*(1-v)*sin(u*n*pi))*cos(2*pi*u),(R+(r1-R)*v)*(1+0.07*(1-v)*sin(u*n*pi))*sin(2*pi*u),z0+(z1-z0)*v-0.25*(1-v)*abs(sin(u*n*pi))),n*2,2,TH,fj=0.12)
thatch(4.3,2.45,2.7,3.5); thatch(3.1,3.3,1.6,4.2); thatch(2.0,4.0,0.12,5.0)
k.cyl(0.2,0.45,(0,0,4.85),'#8a5530',seg=6); k.cyl(0.05,0.35,(0,0,5.25),TH,seg=5,r2=0.3)
LC=['#ff3d3d','#ffd21f','#35d0ff','#5dff7a','#ff5fa8']
for j in range(12):
    a=j*pi/6
    k.sph(0.15,(3.55*sin(a),-3.55*cos(a),2.5-0.12*(j%2)),LC[j%5],sub=1,glow=1)
for (x,c,c2,tl) in ((3.3,'#ff5fa8','#f4f4ee',0.22),(3.9,'#19c2b8','#ffd21f',0.3)):
    fs=k.sph(1.0,(x,-0.6-tl*2,1.55),c,sub=2,sc=(0.3,0.06,1.55),m=RX(tl)@RY(-0.12),smooth=True)
    k.tint(fs, lambda p,n: c2 if abs(p.x-x-0.02)<0.07 else None)
k.box(1.9,0.1,0.6,(0,-3.05,2.75),'#ffd21f',m=RX(-0.15)); k.box(1.4,0.06,0.14,(0,-3.13,3.0),'#e8372c',m=RX(-0.15)); k.box(1.0,0.06,0.12,(0,-3.1,2.86),'#2f7fe8',m=RX(-0.15))
for sx in (-1,1):
    k.cyl(0.05,2.0,(sx*2.3,-4.0,-0.1),BAM,seg=5); k.cyl(0.14,0.25,(sx*2.3,-4.0,1.85),'#8a5530',seg=6,r2=0.2); flame(k,(sx*2.3,-4.0,2.1),0.16,0.5)
R = k.done()
