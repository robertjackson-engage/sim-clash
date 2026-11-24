# v3:stadium The stadium kit: builders for the stand modules and the furniture round them.
# exec'd after lib.py (it uses Kit and its helpers). The numbers of the stands (widths, tiers,
# aisles, tunnel mouths, lamp banks) are the tables of public/render/stadium-kit.js: keep the
# two in step. A stand is modelled STRAIGHT: x across, y = metres behind its front edge
# (Blender's -Y is the front), z up from the pitch; the renderer bends it into its wedge.
TREAD='#2b3348'; CON='#c9cdd6'; CON2='#a3a9b6'; COND='#737a88'; STL='#3b4252'; NOSE='#e2bd2a'; INKC='#12141a'
WHT='#f4f4ee'; RED='#e8372c'; BLU='#1f5fd0'; PANEL='#e6eaf1'; LAMP='#fff6d8'

def uvquad(s, pts, slot, uv=(0,0,1,1)):
    # a textured quad: pts bottom-left, bottom-right, top-right, top-left as seen; uv = (u0, v0, u1, v1), v up
    m = s.xf[-1]; vs = [s.bm.verts.new(m @ Vector(p)) for p in pts]; f = s.bm.faces.new(vs)
    u0 = s.bm.loops.layers.uv['c0']; u1 = s.bm.loops.layers.uv['c1']
    for l,q in zip(f.loops, ((uv[0],uv[1]),(uv[2],uv[1]),(uv[2],uv[3]),(uv[0],uv[3]))):
        l[u0].uv = q; l[u1].uv = (0.0, SLOT[slot])
    return f
Kit.uvquad = uvquad
def adcell(n):
    # cell n (0..15) of the 4 x 4 sponsor atlas, as a uv tuple
    i = n % 4; j = (n // 4) % 4
    return (i/4.0, 1-(j+1)/4.0, (i+1)/4.0, 1-j/4.0)

def steps(d0, z0, tread, rise, rows, cut=None):
    pts = []
    for r in range(rows):
        z = z0 + rise*(cut[0] if (cut and cut[0] <= r <= cut[1]) else r)
        for p in ((d0+tread*r, z), (d0+tread*(r+1), z)):
            if pts and abs(pts[-1][0]-p[0])<1e-6 and abs(pts[-1][1]-p[1])<1e-6: continue
            if len(pts)>1 and abs(pts[-1][1]-p[1])<1e-6 and abs(pts[-2][1]-p[1])<1e-6: pts[-1] = p; continue
            pts.append(p)
    return pts
def rail(k, x0, x1, y, z, h, step=2.0, col=STL):
    n = max(1, int(round((x1-x0)/step)))
    for i in range(n+1): k.strut((x0+(x1-x0)*i/n,y,z),(x0+(x1-x0)*i/n,y,z+h),0.04,col,seg=3)
    for hh in (h*0.55,h): k.strut((x0,y,z+hh),(x1,y,z+hh),0.035,col,seg=3)
def tierseg(k, x0, x1, prof, aisle, ymin, dark=None):
    fs = k.prism(prof, x1-x0, at=((x0+x1)/2,0,0), col=CON, rz=pi/2)
    def tf(c,n):
        if n.z > 0.9: return CON2 if aisle else TREAD
        if dark and n.y < -0.9 and dark[0] < c.y < dark[1]: return INKC
        if n.y < -0.9 and aisle and c.y > ymin: return NOSE
        return None
    k.tint(fs, tf); return fs
def bowl_tier(k, W, aisles, voms, d0, z0, tread, rise, rows, front, back, dark=None):
    xs = sorted(set([-W/2, W/2] + [round(u*W,4) for a in aisles for u in a] + [round(u*W,4) for v in voms for u in v[:2]]))
    for x0, x1 in zip(xs, xs[1:]):
        um = (x0+x1)/2/W
        isA = any(a[0]-1e-6 <= um <= a[1]+1e-6 for a in aisles)
        v = next((v for v in voms if v[0] < um < v[1]), None)
        tierseg(k, x0, x1, front + steps(d0, z0, tread, rise, rows, (v[2], v[3]) if v else None) + back, isA, d0+0.2, dark)
        if v:
            # a tunnel mouth: the dark doorway under the rows behind, an exit light, parapets round the well
            ya = d0+tread*v[2]; yd = d0+tread*(v[3]+1); zf = z0+rise*v[2]; zt = z0+rise*(v[3]+1); xm = (x0+x1)/2
            k.poly([(x0+0.12,yd-0.04,zf),(x1-0.12,yd-0.04,zf),(x1-0.12,yd-0.04,zt-0.3),(x0+0.12,yd-0.04,zt-0.3)], INKC)
            k.poly([(x0+0.7,yd-0.07,zt-0.75),(x1-0.7,yd-0.07,zt-0.75),(x1-0.7,yd-0.07,zt-0.45),(x0+0.7,yd-0.07,zt-0.45)], '#3dff8a', glow=1)
            for xx in (x0,x1): k.prism([(ya,zf),(yd,zf),(yd,zt+1.0),(ya,zf+1.0)],0.16,at=(xx,0,0),col=CON2,rz=pi/2)
            k.box(x1-x0,0.16,1.0,(xm,yd,zt),CON2)
def lampbank(k, at, tilt, nx=4, nz=2, w=3.6):
    k.push(T(*at) @ RX(radians(tilt)))
    h = 0.85*nz
    k.box(w,0.7,h,(0,0,-h),'#2a3040',bev=0.05)
    for a in range(nx):
        for b in range(nz):
            k.cyl(0.34,0.1,(-w/2+(a+0.5)*w/nx,-0.38,-h+0.42+b*0.84),LAMP,seg=8,m=RX(pi/2),glow=1)
    k.pop()
def truss(k, x, a0, a1, b0, b1, n=9, r=0.18):
    # a cantilever truss in the plane x: top chord a0 -> a1, bottom chord b0 -> b1 (each (y, z)), n panels
    A0=Vector((x,a0[0],a0[1])); A1=Vector((x,a1[0],a1[1])); B0=Vector((x,b0[0],b0[1])); B1=Vector((x,b1[0],b1[1]))
    k.strut(A0,A1,r,STL); k.strut(B0,B1,r*0.85,STL)
    for i in range(n):
        t=i/n; t2=(i+1)/n
        k.strut(A0.lerp(A1,t),B0.lerp(B1,t),r*0.45,STL,seg=3); k.strut(B0.lerp(B1,t),A0.lerp(A1,t2),r*0.45,STL,seg=3)

def build_stand(k, corner=False):
    W=24.0; A=[(-0.5,-0.474),(-0.026,0.026),(0.474,0.5)]
    V1=[] if corner else [(-0.31,-0.19,8,12),(0.19,0.31,8,12)]
    V2=[] if corner else [(-0.31,-0.19,4,7),(0.19,0.31,4,7)]
    # the pitch wall: an LED perimeter board along it, a walkway and a rail on top
    k.box(W,2.5,4.8,(0,1.25,-1.5),CON); k.box(W,0.3,0.25,(0,0.15,3.3),CON2)
    k.box(W,0.14,0.4,(0,-0.07,0.0),INKC); k.box(W,0.14,0.3,(0,-0.07,2.1),INKC)
    k.uvquad([(-12,-0.04,0.42),(12,-0.04,0.42),(12,-0.04,2.08),(-12,-0.04,2.08)],'led',(0,0.5,1,1))
    rail(k,-12,12,0.32,3.55,1.0)
    # lower tier, the concourse behind it, the upper tier over the concourse
    bowl_tier(k,W,A,V1,2.5,3.3,0.9,0.405,20,[(2.5,-1.5)],[(20.5,11.4),(24.9,11.4),(24.9,-1.5)])
    bowl_tier(k,W,A,V2,24.0,14.6,0.86,0.56,21,[(23.6,13.9),(23.6,15.4),(24.0,15.4)],[(42.06,26.4),(44.0,26.4),(44.0,11.4),(24.9,11.4),(24.9,13.9)],dark=(24.8,25.0))
    k.uvquad([(-12,23.56,14.0),(12,23.56,14.0),(12,23.56,15.3),(-12,23.56,15.3)],'led',(0,0,1,0.5))
    for x in (-9,-3,3,9): k.box(0.5,0.5,2.5,(x,24.2,11.4),CON2)
    for j in range(8):
        x=-10.5+j*3.0
        k.poly([(x-0.95,24.86,11.75),(x+0.95,24.86,11.75),(x+0.95,24.86,13.3),(x-0.95,24.86,13.3)],('#ffd9a0','#8fe3ff','#ffb46b')[j%3],glow=1)
    # the back wall on the rim, its outside face
    k.box(W,2.5,12.0,(0,45.25,17.0),PANEL)
    k.box(W,2.9,0.5,(0,45.25,29.0),BLU)
    wingrid(k,(0,46.5),(0,1),11.4,22.9,2.0,3,10,lit=0.6)
    for x in (-12,-6,0,6,12): k.box(0.7,0.5,12.4,(x,46.6,17.0),CON2)
    k.box(W,0.45,0.5,(0,46.6,22.2),BLU)
    for x in (-9,-3,3,9):
        k.poly([(x+1.3,46.58,20.3),(x-1.3,46.58,20.3),(x-1.3,46.58,21.9),(x+1.3,46.58,21.9)],INKC)
        k.poly([(x+1.1,46.6,20.4),(x-1.1,46.6,20.4),(x-1.1,46.6,21.6),(x+1.1,46.6,21.6)],'#ffcf8a',glow=1)
    k.box(W,0.7,0.55,(0,47.75,32.7),BLU)
    for j,c in enumerate((RED,BLU,RED)):
        x=-8+j*8.0; k.poly([(x+1.1,46.9,23.2),(x-1.1,46.9,23.2),(x-1.1,46.9,28.6),(x+1.1,46.9,28.6)],c)
        k.uvquad([(x+1.0,46.93,25.2),(x-1.0,46.93,25.2),(x-1.0,46.93,26.2),(x+1.0,46.93,26.2)],'ad',adcell(j))
    # the roof: cantilever trusses off the back columns, a steel deck, a glass canopy to the front edge, masts and stays
    rf=lambda y: 33.0+(47.5-y)*(5.0/36.5)
    for x in (-9,-3,3,9):
        k.box(0.7,0.7,4.4,(x,45.5,29.0),STL)
        truss(k,x,(47.5,rf(47.5)),(11.0,rf(11.0)),(45.5,29.6),(11.8,rf(11.8)-0.5))
    for x in (-9,3):
        k.strut((x,45.5,33.2),(x,45.5,42.0),0.24,WHT,seg=6,r2=0.14)
        k.cyl(0.3,0.5,(x,45.5,42.0),'#ff3d3d',seg=6,glow=1)
        for yy in (31.0,18.0): k.strut((x,45.5,41.6),(x,yy,rf(yy)+0.1),0.05,PANEL,seg=3)
    for j in range(7):
        y=46.5-j*5.6; k.box(W,0.25,0.3,(0,y,rf(y)-0.06),STL)
    fs=k.sheet(lambda u,v:(-12+24*u, 47.9-23.9*v, rf(47.9-23.9*v)+0.28),4,3,'#e3e8f0')
    k.tint(fs, lambda c,n: '#c8d2e2' if int((c.x+12)/6)%2 else None)
    k.sheet(lambda u,v:(-12+24*u, 24.0-13.4*v, rf(24.0-13.4*v)+0.28),4,2,'#bfe6ff',slot='glass')
    k.box(W,0.5,0.9,(0,10.5,rf(10.5)-0.4),WHT); k.box(W,0.1,0.25,(0,10.2,rf(10.5)-0.2),'#fff1c9',glow=1)
    for x in (-8,0,8):
        lampbank(k,(x,13.5,37.0),38)
        for sx in (-1.3,1.3): k.strut((x+sx,13.5,36.9),(x+sx,13.4,rf(13.4)),0.07,STL,seg=3)
    if corner:
        # the corner's pylon: lit fins, a crown of lamps, the flag
        k.box(7,7,33,(0,50.5,17.0),PANEL,bev=0.3)
        for sx in (-2.2,0,2.2):
            k.box(0.5,0.14,26,(sx,46.95,21.0),'#8fe3ff',glow=1); k.box(0.5,0.14,26,(sx,54.05,21.0),'#8fe3ff',glow=1)
            k.box(0.14,0.5,26,(-3.55,50.5+sx,21.0),'#8fe3ff',glow=1); k.box(0.14,0.5,26,(3.55,50.5+sx,21.0),'#8fe3ff',glow=1)
        for zz in (20.2,28.6,37.0,45.4): k.box(7.3,7.3,0.6,(0,50.5,zz),BLU)
        k.box(8.4,8.4,1.2,(0,50.5,50.0),BLU,bev=0.15); k.box(7.7,7.7,0.35,(0,50.5,51.2),WHT)
        rail(k,-4.1,4.1,46.4,51.2,1.0,step=1.37); rail(k,-4.1,4.1,54.6,51.2,1.0,step=1.37)
        lampbank(k,(0,46.4,54.6),30,nx=6,nz=3,w=6.4)
        for sx in (-2.8,2.8): k.strut((sx,47.4,51.5),(sx,46.9,53.2),0.1,STL,seg=4)
        k.strut((0,50.5,51.2),(0,50.5,61.0),0.22,WHT,seg=6,r2=0.1); k.cyl(0.28,0.4,(0,50.5,61.0),'#ff3d3d',seg=6,glow=1)
        k.poly([(0,50.5,60.6),(0,50.5,57.6),(4.6,50.5,58.4),(4.6,50.5,60.2)],RED)

def build_grandstand(k):
    W=30.0; A=[(-0.5,-0.48),(-0.27,-0.23),(-0.02,0.02),(0.23,0.27),(0.48,0.5)]
    k.box(W,1.6,3.1,(0,0.8,-1.2),CON)
    k.box(W,0.14,0.3,(0,-0.07,-0.1),INKC); k.box(W,0.14,0.25,(0,-0.07,1.45),INKC)
    k.uvquad([(-15,-0.04,0.22),(15,-0.04,0.22),(15,-0.04,1.43),(-15,-0.04,1.43)],'led',(0,0.5,1.25,1))
    rail(k,-15,15,0.25,1.9,1.0)
    bowl_tier(k,W,A,[(-0.2,-0.08,3,6),(0.08,0.2,3,6)],1.6,1.9,0.9,0.5,12,[(1.6,-1.2)],[(12.4,8.0),(14.0,8.0),(14.0,-1.2)])
    k.box(W+0.8,1.2,11.7,(0,14.6,-1.2),PANEL)
    wingrid(k,(0,15.2),(0,1),14.2,1.2,2.9,3,12,lit=0.55)
    for j in range(4):
        x=-11.25+j*7.5; k.uvquad([(x+2.6,15.3,0.2),(x-2.6,15.3,0.2),(x-2.6,15.3,1.5),(x+2.6,15.3,1.5)],'ad',adcell(8+j))
    for sx in (-1,1):
        k.prism([(0.0,-1.2),(15.2,-1.2),(15.2,10.5),(12.4,9.2),(1.6,3.3),(0.0,3.3)],0.4,at=(sx*15.2,0,0),col=WHT,rz=pi/2)
        k.prism([(0.0,2.5),(12.4,8.4),(12.4,9.25),(0.0,3.35)],0.46,at=(sx*15.2,0,0),col=BLU,rz=pi/2)
    rf=lambda y: 12.4+(15.6-y)*(1.9/16.8)
    for x in (-12,-6,0,6,12):
        k.box(0.5,0.5,2.3,(x,14.6,10.5),STL)
        truss(k,x,(15.6,rf(15.6)),(-1.0,rf(-1.0)),(14.6,10.9),(-0.5,rf(-0.5)-0.35),n=5,r=0.13)
    for j in range(4):
        y=15.0-j*5.2; k.box(W+0.8,0.2,0.24,(0,y,rf(y)-0.05),STL)
    fs=k.sheet(lambda u,v:(-15.4+30.8*u, 16.0-10.0*v, rf(16.0-10.0*v)+0.2),5,2,'#e3e8f0')
    k.tint(fs, lambda c,n: BLU if int((c.x+15.4)/6.16)%2 else None)
    k.sheet(lambda u,v:(-15.4+30.8*u, 6.0-7.3*v, rf(6.0-7.3*v)+0.2),5,1,'#bfe6ff',slot='glass')
    k.box(W+0.8,0.4,0.6,(0,-1.4,rf(-1.4)-0.2),RED)
    for x in (-9,9): lampbank(k,(x,0.6,rf(0.6)-0.1),32,nx=3,nz=2,w=2.8)
    for j in range(7):
        x=-15+j*5.0; k.strut((x,-1.4,rf(-1.4)+0.3),(x,-1.4,rf(-1.4)+1.5),0.05,WHT,seg=3)
        k.poly([(x,-1.4,rf(-1.4)+1.5),(x+1.3,-1.4,rf(-1.4)+1.2),(x,-1.4,rf(-1.4)+0.9)],(NOSE,RED,WHT,'#2fbf4a')[j%4])

def build_bleacher(k):
    W=18.0
    for r in range(4):
        k.box(W,1.0,0.6+0.55*r,(0,1.0+r,-0.3),'#aeb6c4' if r%2 else '#c3cad6')
        k.box(W,0.08,0.1,(0,0.54+r,0.3+0.55*r),NOSE)
    for sx in (-1,1):
        k.prism([(0.4,-0.3),(4.6,-0.3),(4.6,3.1),(0.4,0.9)],0.14,at=(sx*9.07,0,0),col=BLU,rz=pi/2)
    rail(k,-9,9,4.5,1.95,1.1,step=1.5)
    k.uvquad([(-4.5,4.44,2.0),(4.5,4.44,2.0),(4.5,4.44,2.95),(-4.5,4.44,2.95)],'ad',adcell(12))
    for j in range(10):
        x=-9+j*2.0; k.cyl(0.07,1.05,(x,0.15,0.0),WHT,seg=6); k.sph(0.1,(x,0.15,1.08),NOSE,sub=1)
    k.strut((-9,0.15,0.9),(9,0.15,0.9),0.03,RED,seg=3)
    for sx in (-1,1):
        k.strut((sx*8.9,4.5,3.0),(sx*8.9,4.5,4.3),0.04,WHT,seg=3)
        k.poly([(sx*8.9,4.5,4.3),(sx*8.9-sx*1.1,4.5,4.05),(sx*8.9,4.5,3.8)],RED)

def lattice(k, cx, cy, half, z0, z1, bays, col=STL, r=0.11):
    L=[(cx+a*half, cy+b*half) for a in (-1,1) for b in (-1,1)]
    for (x,y) in L: k.box(r*2,r*2,z1-z0,(x,y,z0),col)
    bh=(z1-z0)/bays
    for b in range(bays):
        za=z0+b*bh; zb=za+bh
        for (p,q) in ((0,1),(1,3),(3,2),(2,0)):
            a=L[p]; c=L[q]
            k.strut((a[0],a[1],zb),(c[0],c[1],zb),r*0.5,col,seg=3)
            if b%2: a,c=c,a
            k.strut((a[0],a[1],za),(c[0],c[1],zb),r*0.45,col,seg=3)

def build_jumbotron(k):
    # a 16:9 screen (the `screen` slot: the game draws into it) in a cabinet on two lattice legs
    for sx in (-1,1):
        k.box(3.2,3.2,1.0,(sx*6.6,0.6,-0.6),CON2,top=0.9); lattice(k,sx*6.6,0.6,0.85,0.4,7.2,4)
    k.box(17.6,1.7,10.4,(0,-0.2,6.6),'#14171f',bev=0.15)
    k.uvquad([(-8,-1.07,7.3),(8,-1.07,7.3),(8,-1.07,16.3),(-8,-1.07,16.3)],'screen',(0,0,1,1))
    for (bx,bz,sx_,sz_) in ((0,7.02,16.5,0.22),(0,16.36,16.5,0.22),(-8.2,7.02,0.22,9.56),(8.2,7.02,0.22,9.56)): k.box(sx_,0.2,sz_,(bx,-1.08,bz),RED)
    k.box(13.0,1.0,1.9,(0,-0.3,17.0),BLU,bev=0.1)
    k.uvquad([(-6.2,-0.83,17.15),(6.2,-0.83,17.15),(6.2,-0.83,18.75),(-6.2,-0.83,18.75)],'ad',(0,0.5,1,0.75))
    k.box(17.6,0.7,1.0,(0,-0.75,5.5),'#14171f')
    k.uvquad([(-8.6,-1.12,5.6),(8.6,-1.12,5.6),(8.6,-1.12,6.4),(-8.6,-1.12,6.4)],'led',(0,0,0.72,0.5))
    for sx in (-1,1):
        for q in range(6):
            k.box(1.05,0.95,0.66,(sx*9.45,-0.85-0.03*q*q,15.6-q*0.72),'#23262e',m=RX(radians(-3*q)),bev=0.04)
            k.box(0.82,0.06,0.44,(sx*9.45,-1.34-0.03*q*q,15.7-q*0.72),'#7d8596',m=RX(radians(-3*q)))
        k.strut((sx*8.8,0.0,16.6),(sx*9.45,-0.85,16.3),0.07,STL)
    for j in range(7):
        x=-7.2+j*2.4; k.cyl(0.4,0.6,(x,-0.6,19.0),'#2a3040',seg=8,m=RX(radians(68)),cap=False)
        k.cyl(0.35,0.05,(x,-1.12,19.2),LAMP,seg=8,m=RX(radians(68)),glow=1)
    k.box(13.4,0.2,0.2,(0,-0.3,18.9),STL)
    for z in (8.4,12.6):
        k.box(16.0,1.0,0.12,(0,1.15,z),'#6f7a8c'); rail(k,-8,8,1.6,z,1.05,col=STL)
    for j in range(8): k.box(16.8,0.12,0.5,(0,0.68,7.6+j*1.15),'#343a4a')
    for z in (2.6,5.2): k.strut((-5.7,0.6,z),(5.7,0.6,z),0.13,STL)
    for j in range(4):
        xa=-5.7+j*2.85; k.strut((xa,0.6,2.6 if j%2==0 else 5.2),(xa+2.85,0.6,5.2 if j%2==0 else 2.6),0.07,STL,seg=3)
    k.cyl(0.25,0.5,(-8.4,-0.2,17.0),'#ff3d3d',seg=6,glow=1); k.cyl(0.25,0.5,(8.4,-0.2,17.0),'#ff3d3d',seg=6,glow=1)

def build_ledboard(k):
    # a run of pitch-side LED perimeter board, 12 m
    k.box(12.0,0.3,1.25,(0,0.1,0.0),'#14171f',bev=0.03)
    k.uvquad([(-5.9,-0.06,0.1),(5.9,-0.06,0.1),(5.9,-0.06,1.15),(-5.9,-0.06,1.15)],'led',(0,0.5,0.6,1))
    for j in range(5): k.prism([(0.0,0.0),(0.9,0.0),(0.0,1.0)],0.1,at=(-5.4+j*2.7,0.25,0),col=STL,rz=pi/2)
    k.box(12.0,0.5,0.25,(0,0.2,-0.25),COND)

def build_adboard(k, cell=4):
    # a lit sponsor hoarding on an A frame, 6.4 m
    k.box(6.4,0.24,1.9,(0,0,0.35),WHT,bev=0.03)
    k.uvquad([(-3.05,-0.13,0.5),(3.05,-0.13,0.5),(3.05,-0.13,2.1),(-3.05,-0.13,2.1)],'ad',adcell(cell))
    k.uvquad([(3.05,0.13,0.5),(-3.05,0.13,0.5),(-3.05,0.13,2.1),(3.05,0.13,2.1)],'ad',adcell(cell+1))
    k.box(6.4,0.3,0.12,(0,0,2.25),LAMP,glow=1)
    for sx in (-2.6,0,2.6):
        k.strut((sx,-0.8,-0.3),(sx,0,0.9),0.06,STL); k.strut((sx,0.8,-0.3),(sx,0,0.9),0.06,STL)
    k.box(6.4,1.7,0.3,(0,0,-0.3),COND)

def build_barrier(k):
    # crash barrier: a run of four padded blocks in red and white, a sponsor band, 8 m
    for j in range(4):
        x=-3+j*2.0; c=RED if j%2==0 else WHT
        k.box(1.96,0.7,0.5,(x,0,-0.25),c,bev=0.08); k.box(1.96,0.42,0.62,(x,0,0.25),c,top=(1,0.6),bev=0.06)
        k.box(0.5,0.72,0.12,(x,0,0.05),'#20232b')
    k.uvquad([(-3.9,-0.36,0.0),(3.9,-0.36,0.0),(3.9,-0.36,0.24),(-3.9,-0.36,0.24)],'led',(0,0,0.5,0.12))

def build_camtower(k):
    # a broadcast camera tower: scaffold, a roofed platform, the camera and its operator
    k.box(4.2,4.2,0.5,(0,0,-0.5),COND)
    lattice(k,0,0,1.6,0.0,8.2,4,col='#8a93a5',r=0.08)
    k.box(4.4,4.4,0.22,(0,0,8.2),'#3a4152',bev=0.04)
    for s in ((-1,-1),(1,-1),(1,1),(-1,1)): k.strut((s[0]*2.1,s[1]*2.1,8.4),(s[0]*2.1,s[1]*2.1,11.0),0.06,STL,seg=4)
    rail(k,-2.1,2.1,-2.1,8.42,1.1,step=1.4); rail(k,-2.1,2.1,2.1,8.42,1.1,step=1.4)
    for sx in (-2.1,2.1):
        for hh in (0.6,1.1): k.strut((sx,-2.1,8.42+hh),(sx,2.1,8.42+hh),0.035,STL,seg=3)
    k.uvquad([(-2.1,-2.16,8.5),(2.1,-2.16,8.5),(2.1,-2.16,9.4),(-2.1,-2.16,9.4)],'ad',adcell(6))
    k.box(4.9,4.9,0.16,(0,0,11.0),BLU,m=RX(radians(6)),bev=0.03)
    for a in range(3):
        q=2*pi*a/3; k.strut((0.5*cos(q),-0.9+0.5*sin(q),8.42),(0,-0.9,9.75),0.045,INKC,seg=3)
    k.box(0.55,1.25,0.6,(0,-1.3,9.75),'#23262e',bev=0.05)
    k.cyl(0.26,0.75,(0,-1.9,10.05),'#101216',seg=8,m=RX(pi/2)); k.cyl(0.2,0.04,(0,-2.66,10.05),'#6fd8ff',seg=8,m=RX(pi/2),glow=1)
    k.box(0.1,0.1,0.1,(0,-1.0,10.4),'#ff2b2b',glow=1)
    person(k,0.15,0.0,8.42,mode='stand',shirt='#20232b')
    for j in range(17): k.strut((1.25,1.72,0.3+j*0.5),(1.95,1.72,0.3+j*0.5),0.03,'#c8ccd6',seg=3)
    k.strut((1.25,1.72,0.0),(1.25,1.72,9.4),0.04,'#c8ccd6',seg=3); k.strut((1.95,1.72,0.0),(1.95,1.72,9.4),0.04,'#c8ccd6',seg=3)

def build_tunnel(k):
    # the players' tunnel: ribbed hoops in two colours running back 14 m, lit inside, a portal with a sign
    n=8
    for i in range(n):
        y=i*1.8; c=BLU if i%2==0 else WHT
        pts=[(3.6*cos(pi*j/10),y,0.2+4.3*sin(pi*j/10)**0.8) for j in range(11)]
        for a,b in zip(pts,pts[1:]):
            k.poly([a,b,(b[0],b[1]+1.8,b[2]),(a[0],a[1]+1.8,a[2])],c)
        for a,b in zip(pts,pts[1:]): k.strut((a[0]*1.03,y,a[2]*1.03),(b[0]*1.03,y,b[2]*1.03),0.13,STL,seg=4)
        k.box(0.3,1.3,0.08,(0,y+0.9,4.36),LAMP,glow=1)
    k.poly([(-3.6,14.4,0.0),(3.6,14.4,0.0),(3.6,14.4,3.6),(-3.6,14.4,3.6)],INKC)
    k.box(7.2,14.4,0.25,(0,7.2,-0.25),'#2f8f4a')
    for sx in (-1,1):
        k.box(1.3,1.3,5.9,(sx*4.3,-0.3,-0.4),PANEL,bev=0.12); k.box(0.25,0.14,4.6,(sx*4.3,-0.98,0.4),'#8fe3ff',glow=1)
        k.box(1.5,1.5,0.4,(sx*4.3,-0.3,5.5),BLU,bev=0.06); flame(k,(sx*4.3,-0.3,5.9),0.42,1.5)
    k.box(9.9,1.0,1.7,(0,-0.3,4.9),'#14171f',bev=0.08)
    k.uvquad([(-4.7,-0.83,5.05),(4.7,-0.83,5.05),(4.7,-0.83,6.45),(-4.7,-0.83,6.45)],'led',(0,0,0.5,0.5))
    for sx in (-1,1):
        k.uvquad([(sx*3.66,0.6,0.5),(sx*3.66,6.6,0.5),(sx*3.66,6.6,2.0),(sx*3.66,0.6,2.0)] if sx<0 else [(sx*3.66,6.6,0.5),(sx*3.66,0.6,0.5),(sx*3.66,0.6,2.0),(sx*3.66,6.6,2.0)],'ad',adcell(13))

def build_podium(k):
    # the tee stage's furniture: a truss arch with lamp cans and a header board, a media wall, a lectern
    for sx in (-1,1):
        k.box(2.2,2.2,0.5,(sx*8.0,0,-0.3),COND,bev=0.06); lattice(k,sx*8.0,0,0.55,0.2,8.6,5,col='#c8ccd6',r=0.07)
    lat=[(a,b) for a in (-0.5,0.5) for b in (8.2,9.2)]
    for (yy,zz) in lat: k.strut((-8.6,yy,zz),(8.6,yy,zz),0.07,'#c8ccd6',seg=4)
    for j in range(12):
        x=-8.6+j*1.5637
        for (p,q) in ((0,1),(1,3),(3,2),(2,0)): k.strut((x,lat[p][0],lat[p][1]),(x+0.78,lat[q][0],lat[q][1]),0.04,'#c8ccd6',seg=3)
    for j in range(8):
        x=-6.3+j*1.8; k.cyl(0.3,0.55,(x,-0.35,7.75),'#23262e',seg=8,m=RX(radians(40)),cap=False)
        k.cyl(0.26,0.05,(x,-0.68,7.52),(LAMP,'#8fe3ff')[j%2],seg=8,m=RX(radians(40)),glow=1)
    k.box(11.0,0.3,1.5,(0,-0.55,9.3),'#14171f',bev=0.05)
    k.uvquad([(-5.3,-0.71,9.4),(5.3,-0.71,9.4),(5.3,-0.71,10.7),(-5.3,-0.71,10.7)],'led',(0,0,0.55,0.5))
    k.box(9.6,0.25,3.4,(0,2.6,0.0),WHT,bev=0.03)
    for j in range(8):
        cx=-3.6+(j%4)*2.4; cz=0.25+(j//4)*1.6
        k.uvquad([(cx-1.15,2.46,cz),(cx+1.15,2.46,cz),(cx+1.15,2.46,cz+1.5),(cx-1.15,2.46,cz+1.5)],'ad',adcell((j*5)%16))
    k.box(1.0,0.7,1.15,(5.6,-1.2,0.0),BLU,top=(1.0,0.75),bev=0.05); k.box(1.15,0.85,0.08,(5.6,-1.2,1.15),WHT)
    k.cyl(0.03,0.35,(5.6,-1.2,1.2),INKC,seg=4); k.sph(0.07,(5.6,-1.2,1.58),INKC,sub=1)
    for sx in (-1,1):
        k.cyl(0.45,0.5,(sx*6.0,-2.4,0.0),'#3a4152',seg=8,r2=0.35); k.cyl(0.3,0.06,(sx*6.0,-2.4,0.5),'#ff9a3d',seg=8,glow=1)
