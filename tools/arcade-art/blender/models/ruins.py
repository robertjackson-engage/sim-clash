k = Kit('ruins', 67)
ST='#ddd6c2'; ST2='#b8b09a'; ST3='#9a927c'; MOSS='#6aaa3f'; IVY='#4c9a35'; BLU='#2f7fe8'
def stone(fs, lo=-0.7, hi=6.0, j=0.07):
    for f in fs:
        t = min(1.0,max(0.0,(f.calc_center_median().z-lo)/(hi-lo))); k.paint([f], mix(ST3,ST,t**0.5), fj=j)
    return fs
# ---- the stylobate: three worn steps, a mosaic floor
for (sx,sy,z,h) in ((20.5,13.5,-0.7,1.0),(18.4,11.4,0.3,0.5),(16.6,9.8,0.8,0.45)): stone(k.box(sx,sy,h,(0,0,z),ST2,bev=0.1), -0.7, 2.5)
for j in range(8):
    a0 = j*pi/4; a1 = a0+pi/4
    k.poly([(0,0,1.27),(2.6*cos(a0),2.6*sin(a0),1.27),(2.6*cos(a1),2.6*sin(a1),1.27)],'#19c2b8' if j%2 else '#f5c021')
    k.poly([(2.6*cos(a0),2.6*sin(a0),1.27),(3.3*cos(a0),3.3*sin(a0),1.27),(3.3*cos(a1),3.3*sin(a1),1.27),(2.6*cos(a1),2.6*sin(a1),1.27)],'#e8372c' if j%2 else '#f4f4ee')
    k.poly([(3.3*cos(a0),3.3*sin(a0),1.27),(3.6*cos(a0),3.6*sin(a0),1.27),(3.6*cos(a1),3.6*sin(a1),1.27),(3.3*cos(a1),3.3*sin(a1),1.27)],'#2f5fc0')
# ---- fluted columns on moulded bases; the whole ones carry capitals
def column(x, y, h, full):
    k.lathe([(1.04,1.25),(1.04,1.46),(0.88,1.6),(0.8,1.7)],10,at=(x,y,0),col=ST2,fj=0.05)
    nd = int(h/1.1); top = 1.7+nd*1.1
    for d in range(nd):
        ox = x+k.rnd.uniform(-.04,.04); oy = y+k.rnd.uniform(-.04,.04); r0 = 0.75-0.012*d
        fs = k.cyl(r0,1.07,(ox,oy,1.7+d*1.1),ST,seg=12,r2=r0-0.012,jit=0.06)
        k.tint(fs, lambda c,n: mix(ST,ST3,0.55) if (abs(n.z) < 0.3 and int(atan2(c.y-oy,c.x-ox)/(2*pi)*12+12) % 2) else None)
    if full:
        k.lathe([(0.7,top),(0.74,top+0.12),(1.02,top+0.36),(1.02,top+0.44)],10,at=(x,y,0),col=ST2,fj=0.04); k.box(2.15,2.15,0.3,(x,y,top+0.44),ST,bev=0.05)
        return top+0.74
    k.cyl(0.7,0.5,(x,y,top),ST,seg=7,r2=0.36,m=RX(k.rnd.uniform(-.25,.25)),fj=0.08)
    return top
tops = [column(x,-3.7,h,f) for (x,h,f) in ((-6.2,5.5,True),(-2.1,5.5,True),(2.1,3.3,False),(6.2,1.1,False))]
column(-6.2,3.7,5.5,True); column(-2.1,3.7,2.2,False); t3 = column(2.1,3.7,5.5,True); column(6.2,3.7,4.4,False)
# ---- what is left of the entablature: architrave, a painted frieze, a corner of the pediment
zt = tops[0]
stone(k.box(6.7,2.0,0.9,(-4.15,-3.7,zt),ST,bev=0.06), 0, 9, 0.05)
for j in range(6):
    k.box(0.52,2.12,0.72,(-6.9+j*1.1,-3.7,zt+0.9),BLU if j%2 else ST2)
    if j%2:
        for e in (-0.14,0.0,0.14): k.box(0.05,2.16,0.6,(-6.9+j*1.1+e,-3.7,zt+0.96),'#1d4fa8')
k.box(7.0,2.34,0.36,(-4.15,-3.7,zt+1.62),ST2,bev=0.05)
k.prism([(-3.45,0),(3.45,0),(3.45,0.4),(-0.6,1.95),(-3.45,0.62)],1.85,at=(-4.15,-3.7,zt+1.98),col=ST,fj=0.05)
k.prism([(-2.9,0.12),(2.6,0.12),(-0.7,1.45),(-2.9,0.5)],1.95,at=(-4.15,-3.7,zt+1.98),col=mix(ST,BLU,0.25))
stone(k.box(4.6,1.5,0.9,(-4.3,3.7,3.2),ST,m=RY(0.75)@T(0.6,0,0),bev=0.06), 0, 9, 0.05)
stone(k.box(6.2,1.6,0.9,(4.0,3.3,0.9),ST2,m=RZ(0.25)@RY(-0.08),bev=0.06), 0, 9, 0.05)
for (x,y,a) in ((4.5,-5.2,0.3),(7.3,-2.2,1.2),(8.6,1.0,2.0),(1.0,-6.3,0.1),(-8.9,-0.5,1.6)):
    fs = k.cyl(0.74,1.1,(x,y,0.65+0.5*(abs(x) < 8.3 and abs(y) < 4.9)),ST,seg=12,m=RZ(a)@RX(pi/2)@T(0,0,-0.55),jit=0.08)
    k.tint(fs, lambda c,n: mix(ST,ST3,0.5) if k.rnd.random() < 0.45 else None)
for i in range(11):
    x = k.rnd.uniform(-9.5,9.5); y = k.rnd.uniform(-6.3,6.3)
    zf = 1.25 if (abs(x) < 8.3 and abs(y) < 4.9) else (0.8 if (abs(x) < 9.2 and abs(y) < 5.7) else 0.3)
    k.box(1.2+k.rnd.random()*0.6,0.9+k.rnd.random()*0.5,0.7+k.rnd.random()*0.4,(x,y,zf-0.1),ST if i%2 else ST2,m=RZ(k.rnd.random()*3)@RX(k.rnd.uniform(-.25,.25)),jit=0.08,bev=0.07)
# ---- an urn on its plinth, two bronze braziers that still burn
k.box(2.2,2.2,1.5,(0,2.9,1.25),ST2,bev=0.1); k.box(2.5,2.5,0.2,(0,2.9,2.75),ST,bev=0.05)
k.lathe([(0.5,2.95),(0.3,3.2),(0.9,4.0),(1.0,4.7),(0.6,5.1),(0.75,5.4),(0.55,5.4)],10,at=(0,2.9,0),col='#19a8a0',cols=['#19a8a0','#19a8a0','#f5c021','#19a8a0','#19a8a0','#f5c021'],smooth=True)
def brazier(x, y, z):
    for a in (0.5,2.6,4.7): k.strut((x+0.55*cos(a),y+0.55*sin(a),z),(x+0.12*cos(a),y+0.12*sin(a),z+1.25),0.06,'#7a5a2c',seg=4)
    k.lathe([(0.15,z+1.2),(0.55,z+1.4),(0.62,z+1.62),(0.5,z+1.62),(0,z+1.5)],8,at=(x,y,0),col='#b07a2c',fj=0.08); flame(k,(x,y,z+1.5),0.42,1.1)
brazier(-4.1,-0.3,1.25); brazier(4.2,0.4,1.25)
# ---- moss, ivy
for i in range(14):
    x = k.rnd.uniform(-9.8,9.8); y = k.rnd.uniform(-6.5,6.5)
    zf = 1.25 if (abs(x) < 8.3 and abs(y) < 4.9) else (0.8 if (abs(x) < 9.2 and abs(y) < 5.7) else 0.3)
    k.rock(0.6+k.rnd.random()*0.7,(x,y,zf),MOSS,sub=1,sc=(1.3,1.1,0.4),fj=0.14)
for j in range(7):
    x = -7.0+j*0.95; L = 1.0+k.rnd.random()*2.2
    k.box(0.35,0.12,L,(x,-4.78,zt+0.9-L),IVY,top=(0.4,1))
for j in range(5):
    L = 1.2+k.rnd.random()*2.0; a = j*1.26
    k.box(0.3,0.1,L,(2.1+0.78*cos(a),3.7+0.78*sin(a),t3-0.4-L),IVY,rz=a+pi/2,top=(0.4,1))
k.rock(0.9,(-6.4,-3.7,zt+2.2),MOSS,sub=1,sc=(1.6,1.2,0.5)); k.rock(0.8,(2.1,3.7,t3+0.1),MOSS,sub=1,sc=(1.4,1.4,0.5))
R = k.done()
