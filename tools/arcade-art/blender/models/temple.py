k = Kit('temple', 51)
S1='#b9ad8f'; S2='#9c9076'; S3='#cdc1a0'; MOSS='#5fa83a'; DK='#2e2a23'
N=6; TH=3.6; W0=40.0; DW=5.4
k.box(W0+4,W0+4,1.5,(0,0,-1.3),S2,fj=0.05)
for i in range(N):
    w=W0-i*DW; z=i*TH+0.2
    k.box(w,w,TH,(0,0,z),S1,top=1-1.2/w,fj=0.06)
    k.box(w-0.5,w-0.5,0.45,(0,0,z+TH-0.45),S2)
    for q in range(4):
        k.push(RZ(q*pi/2))
        nb=int((w-4)/3.4)
        for j in range(nb):
            x=-(nb-1)*1.7+j*3.4
            if abs(x)<5.4: continue
            k.box(1.9,0.5,2.0,(x,-w/2+0.3,z+0.6),S2 if (j+i)%2 else S3)
            k.box(0.9,0.2,0.9,(x,-w/2+0.0,z+1.15),S1)
        if q>0 and i%2==0:
            k.box(5.4,0.7,2.4,(0,-w/2+0.35,z+0.5),DK); k.cyl(0.9,0.25,(0,-w/2-0.05,z+1.7),'#e8b93a',seg=8,m=RX(pi/2))
            for sx in (-1,1): k.box(0.9,0.3,1.4,(sx*1.8,-w/2-0.05,z+1.0),'#19c2b8')
        k.pop()
YT=-(W0-(N-1)*DW)/2+0.6; ZT=N*TH+0.2; Y0=-W0/2-1.5; RUN=(YT-Y0)/24
for j in range(24):
    y=Y0+j*RUN
    k.box(8.0,YT-y+0.4,0.9,(0,(y+YT+0.4)/2,0.2+j*0.9),S3 if j%2 else '#d9cdaa')
for sx in (-1,1):
    k.prism([(Y0-0.8,0.2),(YT,ZT),(YT,ZT+1.3),(Y0-0.8,1.9)],1.2,at=(sx*4.6,0,0),col=S2,rz=pi/2)
    k.box(1.9,2.6,1.7,(sx*4.6,Y0-1.6,0.2),'#6fae5a',bev=0.2); k.box(2.1,1.4,0.5,(sx*4.6,Y0-2.4,0.2),'#5a9648')
    for e in (-1,1): k.box(0.3,0.12,0.3,(sx*4.6+e*0.5,Y0-2.93,1.3),'#ffd21f',glow=1)
    for e in range(4): k.cyl(0.14,0.4,(sx*4.6-0.6+e*0.4,Y0-2.9,0.7),'#f4f4ee',seg=4,r2=0,m=RX(pi))
    k.prism([(-0.5,0),(0.5,0),(0,1.1)],1.6,at=(sx*4.6,Y0-1.4,1.9),col='#e8372c',rz=pi/2)
    k.cyl(0.3,2.6,(sx*5.8,YT-0.6,ZT),S2,seg=6); flame(k,(sx*5.8,YT-0.6,ZT+2.6),0.45,1.3)
    k.cyl(0.4,2.2,(sx*7.0,Y0-2.0,0.2),S2,seg=6); flame(k,(sx*7.0,Y0-2.0,2.4),0.55,1.5)
k.box(9.0,7.0,5.2,(0,1.2,ZT),S1,fj=0.05)
k.box(3.0,0.5,3.9,(0,-2.2,ZT),DK); k.poly([(-1.0,-2.47,ZT+0.1),(1.0,-2.47,ZT+0.1),(1.0,-2.47,ZT+3.0),(-1.0,-2.47,ZT+3.0)],'#ff8a1f',glow=1)
k.box(4.2,0.7,0.7,(0,-2.25,ZT+3.9),S3)
for sx in (-1,1):
    k.box(1.6,0.4,2.2,(sx*3.2,-2.35,ZT+1.2),S2); k.box(0.8,0.2,0.8,(sx*3.2,-2.55,ZT+2.0),'#19c2b8')
k.box(10.6,8.6,1.0,(0,1.2,ZT+5.2),S2,top=0.93)
k.box(7.2,1.5,3.6,(0,1.8,ZT+6.2),S1,fj=0.05)
for x in (-2.2,0,2.2): k.box(1.1,1.7,1.5,(x,1.8,ZT+7.0),DK)
k.box(8.0,1.8,0.5,(0,1.8,ZT+9.8),S3); k.cyl(1.2,0.3,(0,0.95,ZT+8.5),'#f5c021',seg=10,m=RX(pi/2))
for i in range(34):
    ti=k.rnd.randint(0,N-1); w=W0-ti*DW; q=k.rnd.randint(0,3); a=k.rnd.uniform(-w/2+1,w/2-1)
    k.push(RZ(q*pi/2))
    if not (q==0 and abs(a)<6): k.rock(0.9+k.rnd.random()*0.9,(a,-w/2+1.5,ti*TH+0.2+TH),MOSS,sub=1,sc=(1.3,1,0.35),fj=0.12)
    k.pop()
for i in range(14):
    ti=k.rnd.randint(1,N-1); w=W0-ti*DW; q=k.rnd.randint(1,3); a=k.rnd.uniform(-w/2+2,w/2-2)
    k.push(RZ(q*pi/2)); k.box(0.7,0.2,1.5+k.rnd.random()*1.8,(a,-w/2+0.15,ti*TH+0.2+TH-2.6),'#4c9a35',top=(0.5,1)); k.pop()
R = k.done()
