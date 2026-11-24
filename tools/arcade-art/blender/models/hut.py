k = Kit('hut', 33)
BAM='#d9b25a'; BAM2='#b28a3c'; WOOD='#a0683a'; WOOD2='#7d4d28'; TH='#d6a544'; TH2='#b3852e'; TH3='#e6c067'; RED='#e8372c'; TEAL='#19c2b8'; YEL='#ffd21f'; PINK='#ff5fa8'; DK='#3b4252'
k.cyl(3.55,0.7,(0,0,-0.4),WOOD2,seg=12,fj=0.08); k.cyl(3.8,0.14,(0,0,0.2),'#c08a52',seg=12,fj=0.07)
# ---- bamboo posts, a woven half wall, a rail
for j in range(8):
    a = j*pi/4+pi/8; x = 2.85*sin(a); y = -2.85*cos(a)
    k.cyl(0.17,2.6,(x,y,0.3),BAM,seg=6,cap=False)
    for z in (1.0,1.9): k.cyl(0.2,0.08,(x,y,z),BAM2,seg=6,cap=False)
A0 = 0.55; SP = 2*pi-2*A0
fs = k.sheet(lambda u,v:(2.88*sin(A0+u*SP),-2.88*cos(A0+u*SP),0.3+1.2*v),30,3,BAM,fj=0.08)
k.tint(fs, lambda c,n: BAM2 if (int((((atan2(c.x,-c.y)) % (2*pi))-A0)/SP*30)+int((c.z-0.3)/0.4)) % 2 else None)
k.tube([(2.94*sin(A0+SP*i/16),-2.94*cos(A0+SP*i/16),1.54) for i in range(17)],0.09,col=WOOD,seg=4)
# ---- the bar: bamboo front, a thick top, stools, drinks, bottles on the centre post
k.box(2.7,0.7,1.0,(0,-2.72,0.3),WOOD2)
for i in range(9): k.cyl(0.15,1.0,(-1.2+i*0.3,-3.07,0.3),BAM if i%2 else BAM2,seg=5,cap=False)
k.box(3.1,1.05,0.13,(0,-2.8,1.3),'#6b3f20',bev=0.04)
for x in (-0.95,0,0.95):
    k.cyl(0.27,0.1,(x,-3.85,0.92),RED,seg=8); k.cyl(0.05,0.72,(x,-3.85,0.2),DK,seg=4,cap=False); k.cyl(0.2,0.04,(x,-3.85,0.2),DK,seg=6)
for (c,x) in ((TEAL,-0.75),(PINK,-0.1),(YEL,0.45)): k.cyl(0.1,0.3,(x,-2.85,1.43),c,seg=6,r2=0.15)
k.lathe([(0.13,1.43),(0.2,1.6),(0.13,1.8),(0,1.84)],6,at=(1.05,-2.8,0),col='#f0b428',fj=0.1); k.cyl(0.12,0.3,(1.05,-2.8,1.8),'#3f9a3a',seg=5,r2=0.0)
k.cyl(0.42,2.6,(0,0,0.3),WOOD2,seg=8,cap=False); k.cyl(1.0,0.08,(0,0,1.25),WOOD,seg=10); k.cyl(0.85,0.08,(0,0,1.85),WOOD,seg=10)
for (j,c) in enumerate((RED,TEAL,YEL,PINK,'#35d0ff','#5dff7a',RED,YEL)):
    a = pi+ (j-3.5)*0.42
    k.cyl(0.07,0.34,(0.8*sin(a)*(1 if j%2 else 0.82),0.8*cos(a)*(1 if j%2 else 0.82),1.33 if j%2 else 1.93),c,seg=5,r2=0.03,glow=(1 if j%3 == 0 else 0))
k.box(0.3,0.3,0.36,(0,-1.9,2.15),'#ffb347',glow=1); k.strut((0,-1.9,2.5),(0,-1.9,2.9),0.02,DK,seg=3)
# ---- the sign over the bar
k.box(2.2,0.1,0.7,(0,-3.1,2.62),'#7a4a28',m=RX(-0.15),bev=0.03)
for (x,c) in ((-0.75,RED),(-0.25,YEL),(0.25,TEAL),(0.75,PINK)): k.box(0.4,0.05,0.44,(x,-3.17,2.74),c,m=RX(-0.15))
for sx in (-1,1): k.strut((sx*0.95,-3.0,3.25),(sx*0.95,-3.25,3.55),0.02,DK,seg=3)
# ---- thatch in three shaggy skirts, darker at the eaves; a top knot
k.lathe([(3.7,2.2),(2.5,3.2),(0.2,4.75)],12,col='#6b4a22')
skirtcone(k,4.3,2.42,2.75,3.55,22,TH2,droop=0.32,jag=0.08,fj=0.07); skirtcone(k,3.15,3.3,1.65,4.25,22,TH,droop=0.3,jag=0.08,fj=0.07); skirtcone(k,2.05,4.02,0.12,5.05,22,TH3,droop=0.25,jag=0.07,fj=0.06)
k.cyl(0.24,0.5,(0,0,4.85),WOOD2,seg=6); k.strut((-0.5,0,4.9),(0.42,0,5.68),0.05,BAM,seg=4); k.strut((0.5,0,4.9),(-0.42,0,5.68),0.05,BAM,seg=4)
# ---- party lights under the eave, surfboards, torches
LC = ['#ff3d3d','#ffd21f','#35d0ff','#5dff7a','#ff5fa8']
for j in range(14):
    a = j*2*pi/14; z = 2.42-0.1*(j%2)
    k.lathe([(0,z-0.17),(0.15,z),(0,z+0.17)],4,at=(3.6*sin(a),-3.6*cos(a),0),col=LC[j%5],glow=1)
BD = [(0,0),(0.2,0.25),(0.28,0.9),(0.26,1.8),(0.17,2.6),(0,3.05),(-0.17,2.6),(-0.26,1.8),(-0.28,0.9),(-0.2,0.25)]
for (x,y,c,c2,tl,rzz) in ((3.25,-0.5,PINK,'#f4f4ee',-0.2,pi/2),(3.3,0.35,TEAL,YEL,-0.24,pi/2+0.25),(-3.3,-0.2,'#ff8a1f','#f4f4ee',0.22,pi/2-0.15)):
    k.prism(BD,0.09,at=(x,y,0.3),col=c,rz=rzz,m=RX(tl))
    k.push(T(x,y,0.3)@RZ(rzz)@RX(tl))
    for sg in (-1,1): k.poly([(-0.035,sg*0.055,0.2),(0.035,sg*0.055,0.2),(0.035,sg*0.055,2.85),(-0.035,sg*0.055,2.85)],c2)
    k.pop()
for sx in (-1,1):
    k.cyl(0.05,2.0,(sx*2.3,-4.0,-0.1),BAM,seg=5,cap=False); k.cyl(0.14,0.25,(sx*2.3,-4.0,1.85),'#8a5530',seg=6,r2=0.2); flame(k,(sx*2.3,-4.0,2.1),0.17,0.55)
R = k.done()
