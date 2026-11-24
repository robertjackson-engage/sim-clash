k = Kit('torii', 57)
VR='#e8431f'; VR2='#c53516'; BK='#22201f'; BK2='#38332f'; STN='#a8a294'; STN2='#8a8478'; GOLD='#f5c021'; ROPE='#e9dfbf'
k.box(9.8,3.0,0.5,(0,0,-0.4),STN,bev=0.08,fj=0.05); k.box(3.6,3.2,0.1,(0,0,0.06),'#bdb6a6',fj=0.04)
PX = 3.1
def beam(x0, x1, n, zf, h, db, dt, col, top=None):
    # a lintel swept along a rising curve: flat top and bottom, the faces leaning out to the top
    X = lambda u: x0+(x1-x0)*u
    k.sheet(lambda u,v:(X(u),(2*v-1)*dt,zf(X(u))+h),n,1,top or col)
    k.sheet(lambda u,v:(X(u),(1-2*v)*db,zf(X(u))),n,1,col)
    k.sheet(lambda u,v:(X(u),-(db+(dt-db)*v),zf(X(u))+h*v),n,1,col); k.sheet(lambda u,v:(X(u),(db+(dt-db)*(1-v)),zf(X(u))+h*(1-v)),n,1,col)
    for x in (x0,x1): k.poly([(x,-db,zf(x)),(x,db,zf(x)),(x,dt,zf(x)+h),(x,-dt,zf(x)+h)],col)
for sx in (-1,1):
    k.lathe([(0.98,0.08),(0.98,0.32),(0.8,0.52),(0.6,0.64)],12,at=(sx*PX,0,0),col=STN2,fj=0.06)
    k.lathe([(0.57,0.6),(0.57,1.45),(0.5,1.52)],12,at=(sx*PX,0,0),col=BK)
    k.strut((sx*PX,0,1.48),(sx*(PX-0.16),0,7.32),0.47,VR,seg=12,r2=0.38,cap=True,smooth=True)
    k.box(1.02,1.02,0.2,(sx*(PX-0.16),0,7.3),BK,bev=0.04)
    for e in (-1,1): k.box(0.22,0.6,0.52,(sx*(PX-0.05)+e*0.56,0,5.5),BK,top=(0.7,1))
    # a paper lantern under the tie beam
    lx = sx*1.7; lz = 4.55
    k.strut((lx,0,5.45),(lx,0,lz+0.55),0.02,BK,seg=3)
    k.lathe([(0.14,lz+0.5),(0.36,lz+0.3),(0.43,lz),(0.36,lz-0.3),(0.14,lz-0.5)],8,at=(lx,0,0),col='#ff5a2a',cols=['#ff5a2a','#ff7a3a','#ff7a3a','#ff5a2a'],glow=1)
    k.cyl(0.17,0.09,(lx,0,lz+0.5),BK,seg=8); k.cyl(0.17,0.09,(lx,0,lz-0.59),BK,seg=8); k.cyl(0.05,0.3,(lx,0,lz-0.6),GOLD,seg=4,r2=0.0,m=RX(pi))
k.box(8.7,0.42,0.62,(0,0,5.45),VR,bev=0.05)
k.box(0.5,0.34,1.3,(0,0,6.07),VR2); k.box(1.0,0.14,1.28,(0,-0.24,6.1),BK,bev=0.03); k.box(0.78,0.06,1.06,(0,-0.33,6.21),GOLD)
k.poly([(-0.29,-0.37,6.31),(0.29,-0.37,6.31),(0.29,-0.37,7.17),(-0.29,-0.37,7.17)],'#1b2a5a')
for (z,w) in ((6.95,0.3),(6.72,0.2),(6.5,0.34)): k.poly([(-w/2,-0.39,z),(w/2,-0.39,z),(w/2,-0.39,z+0.08),(-w/2,-0.39,z+0.08)],GOLD)
zl = lambda x: 7.44+0.78*(abs(x)/5.3)**2.2
beam(-4.95,4.95,16,zl,0.42,0.36,0.42,VR)
beam(-5.3,5.3,16,lambda x: zl(x)+0.42,0.36,0.5,0.66,BK,top=BK2)
pts = [(-2.72+5.44*i/8,-0.52,4.95-0.5*sin(pi*i/8)) for i in range(9)]
k.tube(pts,0.12,col=ROPE,seg=5)
for i in (1,3,5,7):
    p = pts[i]
    k.poly([(p[0]-0.14,p[1]-0.06,p[2]),(p[0]+0.14,p[1]-0.06,p[2]),(p[0]+0.22,p[1]-0.06,p[2]-0.42),(p[0]+0.0,p[1]-0.06,p[2]-0.5),(p[0]-0.08,p[1]-0.06,p[2]-0.85)],'#ffffff')
for i in (2,4,6):
    p = pts[i]; k.cyl(0.1,0.5,(p[0],p[1],p[2]-0.6),ROPE,seg=5,r2=0.17)
R = k.done()
