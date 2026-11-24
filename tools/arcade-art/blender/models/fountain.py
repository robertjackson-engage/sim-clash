k = Kit('fountain', 29)
ST='#e6dabf'; ST2='#c9b994'; WA='#3fc8f0'; WH='#dff6ff'
k.lathe([(5.4,-0.5),(5.4,0.25),(5.2,0.35),(5.2,0.95),(5.0,1.05),(4.6,1.05),(4.6,0.4),(0,0.4)],16,col=ST,fj=0.04)
k.lathe([(5.45,0.25),(5.45,0.36)],16,col=ST2)
k.lathe([(4.6,0.82),(0,0.82)],16,col=WA,fj=0.05)
k.lathe([(1.2,0.4),(1.0,1.0),(0.55,1.5),(0.5,2.3),(0.75,2.65),(2.7,3.0),(2.8,3.22),(2.5,3.2),(0.6,2.98)],12,col=ST,smooth=True)
k.lathe([(2.5,3.14),(0,3.14)],12,col=WA)
k.lathe([(0.5,3.0),(0.38,3.9),(0.55,4.1),(1.5,4.4),(1.6,4.58),(1.35,4.55),(0.3,4.38)],12,col=ST,smooth=True)
k.lathe([(1.35,4.5),(0,4.5)],12,col=WA)
k.lathe([(0.26,4.4),(0.2,5.0),(0.36,5.1),(0.12,5.25)],8,col=ST2,smooth=True)
k.sph(0.36,(0,0,5.55),'#f5c021',sub=2,smooth=True)
k.cyl(0.1,0.5,(0,0,5.85),WH,seg=5,r2=0.02)
def curtain(r0,z0,r1,z1,n,wd):
    for j in range(n):
        a0=2*pi*j/n
        k.sheet(lambda u,v:((r0+(r1-r0)*v**0.6)*cos(a0+wd*(u-0.5)),(r0+(r1-r0)*v**0.6)*sin(a0+wd*(u-0.5)),z0+(z1-z0)*v**1.6),1,3,'#bfeeff' if j%2 else WH)
curtain(2.82,3.2,3.2,0.85,12,0.28)
curtain(1.62,4.56,1.95,3.16,8,0.3)
for j in range(8):
    a=2*pi*(j+0.5)/8; ca=cos(a); sa=sin(a)
    pts=[((4.75-2.6*t)*ca,(4.75-2.6*t)*sa,1.15+4.2*t-4.0*t*t+1.9*t) for t in (0,0.25,0.5,0.75,1.0)]
    k.tube(pts,[0.07,0.08,0.09,0.1,0.11],col=WH,seg=4,cap=False)
    k.sph(0.22,(4.8*ca,4.8*sa,1.12),'#f5c021',sub=1)
for j in range(4):
    a=j*pi/2+pi/4
    k.box(0.9,0.9,1.5,(5.1*cos(a),5.1*sin(a),-0.4),ST2,rz=a,bev=0.08)
    k.sph(0.42,(5.1*cos(a),5.1*sin(a),1.45),ST,sub=1)
R = k.done()
