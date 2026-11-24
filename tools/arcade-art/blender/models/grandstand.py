k = Kit('grandstand', 3)
W=30.0; ROWS=10; TD=1.1; RH=0.72; Y0=-6.6; Z0=1.7; YB=Y0+ROWS*TD; ZT=Z0+ROWS*RH
CON='#cfd3da'; CON2='#9aa0ad'; ST='#3b4252'
AISLES=(-7.5,0.0,7.5)
for i in range(ROWS):
    zb = -0.6 if i==0 else Z0+(i-1)*RH
    y0 = Y0+i*TD
    k.box(W, YB-y0, Z0+i*RH-zb, (0,(y0+YB)/2,zb), CON if i%2 else '#bcc2cc')
k.box(W, 0.5, 2.3, (0,Y0-0.25,-0.6), CON2)
ADS=['#e8372c','#ffd21f','#2f7fe8','#2fbf4a','#ff8a1f','#8e4de0','#19c2b8','#ff5fa8','#e8372c','#2f7fe8']
for j in range(10):
    x=-13.5+j*3.0
    k.box(2.8,0.12,1.25,(x,Y0-0.56,0.25),ADS[j])
    k.box(1.5,0.06,0.26,(x+0.3,Y0-0.64,0.74),'#f4f4ee')
    k.cyl(0.36,0.08,(x-0.95,Y0-0.6,0.87),'#f4f4ee',seg=8,m=RX(pi/2))
SEATC=['#2f7fe8','#f4f4ee','#e8372c']
for i in range(ROWS):
    yt=Y0+i*TD; zt=Z0+i*RH
    for j in range(42):
        x=-14.35+j*0.7
        if any(abs(x-a)<0.85 for a in AISLES): continue
        if 3<=i<=5 and min(abs(x-3.75),abs(x+3.75))<1.5: continue
        c=SEATC[((j+i*2)//5)%3]
        yb=yt+0.95
        k.poly([(x-0.27,yb,zt+0.38),(x+0.27,yb,zt+0.38),(x+0.27,yb+0.06,zt+0.9),(x-0.27,yb+0.06,zt+0.9)],c)
        k.poly([(x-0.27,yb-0.42,zt+0.4),(x+0.27,yb-0.42,zt+0.4),(x+0.27,yb,zt+0.38),(x-0.27,yb,zt+0.38)],c)
        if k.rnd.random()<0.62:
            st = k.rnd.random()<0.12
            person(k, x, yb-0.2, zt+(0.0 if st else 0.4), mode='stand' if st else 'bust', arms=st or k.rnd.random()<0.15)
for a in AISLES:
    for i in range(ROWS):
        k.box(1.3, TD/2, RH/2, (a, Y0+i*TD+TD*0.75, Z0+i*RH), '#aab0bb')
        k.box(1.3,0.1,0.07,(a,Y0+i*TD+TD*0.5+0.02,Z0+i*RH+RH/2),'#ffd21f')
        k.box(1.3,0.1,0.07,(a,Y0+i*TD+0.02,Z0+i*RH),'#ffd21f')
for vx in (-3.75,3.75):
    fs=k.box(2.6, 2.6, 2.1, (vx, Y0+3*TD+1.3, Z0+2*RH+0.05), CON2)
    k.tint(fs, lambda c,n: '#14161c' if n.y<-0.9 else None)
    k.box(2.7,0.1,0.3,(vx,Y0+3*TD-0.05,Z0+2*RH+2.15),'#ffd21f')
for j in range(21):
    x=-15+j*1.5
    k.strut((x,Y0-0.3,Z0),(x,Y0-0.3,Z0+1.0),0.045,ST)
for h in (0.55,1.0): k.strut((-15,Y0-0.3,Z0+h),(15,Y0-0.3,Z0+h),0.045,ST)
prof=[(Y0-0.5,-0.6),(8.6,-0.6),(8.6,11.2),(YB,11.2),(YB,ZT+0.6),(Y0-0.5,Z0+0.9)]
band=[(Y0-0.52,Z0-0.5),(YB+0.02,ZT-0.8),(YB+0.02,ZT),(Y0-0.52,Z0+0.3)]
for sx in (-1,1):
    k.prism(prof,0.5,at=(sx*(W/2+0.25),0,0),col='#f4f4ee',rz=pi/2)
    k.prism(band,0.58,at=(sx*(W/2+0.25),0,0),col='#2f7fe8',rz=pi/2)
    k.prism([(4.0,ZT+0.9),(8.62,ZT+0.9),(8.62,ZT+1.6),(4.0,ZT+1.6)],0.58,at=(sx*(W/2+0.25),0,0),col='#e8372c',rz=pi/2)
k.box(W, 8.6-YB, 11.8, (0,(YB+8.6)/2,-0.6), '#e9ecf2')
for j in range(12):
    x=-13.75+j*2.5
    k.poly([(x-1.1,YB-0.03,ZT+0.55),(x+1.1,YB-0.03,ZT+0.55),(x+1.1,YB-0.03,ZT+1.6),(x-1.1,YB-0.03,ZT+1.6)],'#9fe8ff',glow=1)
LED=['#ff3d3d','#ffd21f','#f4f4ee']
for j in range(30):
    x=-14.5+j
    k.poly([(x-0.46,YB-0.03,ZT+1.78),(x+0.46,YB-0.03,ZT+1.78),(x+0.46,YB-0.03,ZT+2.2),(x-0.46,YB-0.03,ZT+2.2)],LED[j%3],glow=1)
BAN=['#e8372c','#2f7fe8','#ffd21f','#2fbf4a','#8e4de0']
for j in range(5):
    x=-12+j*6.0
    k.poly([(x+1.6,8.63,2.5),(x-1.6,8.63,2.5),(x-1.6,8.63,10.2),(x+1.6,8.63,10.2)],BAN[j])
    k.poly([(x+0.9,8.66,5.2),(x-0.9,8.66,5.2),(x-0.9,8.66,7.4),(x+0.9,8.66,7.4)],'#f4f4ee')
for j in range(4):
    x=-9+j*6.0
    k.poly([(x+1.0,8.63,0.0),(x-1.0,8.63,0.0),(x-1.0,8.63,2.2),(x+1.0,8.63,2.2)],'#20232b')
for x in [-14+5.6*j for j in range(6)]:
    k.box(0.5,0.5,12.6,(x,8.35,-0.6),ST)
    tip=(x,-7.6,13.0)
    k.strut((x,8.6,11.95),tip,0.14,ST)
    k.strut((x,8.35,11.3),(x,-7.6,12.8),0.11,ST)
    for q in range(1,7):
        t=q/7; t2=(q-1)/7
        a=(x,8.6-16.2*t,11.95+1.05*t); b=(x,8.35-15.95*t,11.3+1.5*t); b2=(x,8.35-15.95*t2,11.3+1.5*t2)
        k.strut(a,b,0.055,ST,seg=3); k.strut(a,b2,0.055,ST,seg=3)
fs=k.sheet(lambda u,v: (-15.6+31.2*u, 8.9-16.9*v, 12.15+1.1*v+0.22*sin(pi*v)), 12, 6, '#f4f4ee')
k.tint(fs, lambda c,n: '#2f7fe8' if int((c.x+15.6)/2.6)%2 else None)
k.box(31.2,0.3,0.6,(0,-8.0,12.9),'#e8372c')
for j in range(12):
    k.box(1.6,0.3,0.16,(-14.3+j*2.6,-7.55,12.72),'#fff4c2',glow=1)
PEN=['#ffd21f','#e8372c','#f4f4ee','#2fbf4a','#ffd21f','#e8372c','#f4f4ee']
for j in range(7):
    x=-15+j*5.0
    k.strut((x,-8.0,13.4),(x,-8.0,14.6),0.05,'#f4f4ee')
    k.poly([(x,-8.0,14.6),(x+1.3,-8.0,14.3),(x,-8.0,14.0)],PEN[j])
R = k.done()
