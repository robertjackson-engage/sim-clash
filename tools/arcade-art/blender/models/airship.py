k = Kit('airship', 41)
# envelope: axis along Y, nose at -Y. 36 m long
N=14; SEG=16; L=36.0; R=6.2
prof=[]
for i in range(N+1):
    t=i/N; prof.append((max(0.0, R*(sin(pi*t)**0.62) if 0<t<1 else 0.0), -L/2+L*t))
STR=['#e8372c','#ffd21f']
fs=k.lathe(prof, SEG, col='#e8372c', m=T(0,0,12.9)@RX(pi/2), smooth=True)
def band(c,n):
    a=atan2(c.z-12.9,c.x); i=int((a+pi)/(2*pi)*SEG+0.001)%SEG
    if abs(c.y)<1.6: return '#f4f4ee'
    return STR[(i//2)%2]
k.tint(fs, band)
k.lathe([(0,0),(0.9,0.5),(1.0,1.3),(0,1.5)],8,col='#f5c021',m=T(0,-L/2-0.6,12.9)@RX(pi/2),smooth=True)
# tail fins (4) at +Y
for q in range(4):
    k.push(T(0,0,12.9)@RY(q*pi/2+pi/4))
    k.prism([(0,0),(5.0,0),(6.2,5.2),(3.6,5.6),(1.0,3.0)],0.3,at=(0,0,0),col='#2f7fe8',m=T(0,15.6,2.6)@RZ(-pi/2)@T(-5.0,0,0))
    k.prism([(0.4,0.3),(4.4,0.3),(5.0,1.3),(0.8,1.3)],0.36,at=(0,0,0),col='#ffd21f',m=T(0,15.6,2.6)@RZ(-pi/2)@T(-5.0,0,0))
    k.pop()
# rigging + ship gondola
k.push(T(0,0.5,0.0))
fs,sheer,w=hull(k, 17.0, 5.0, 3.0, '#a0683a', deck='#d9b25a', stripe='#f5c021', nu=10, nv=6)
k.tint(fs, lambda c,n: '#6e4424' if c.z<1.0+0.5 else None)
k.box(4.2,3.4,2.0,(0,5.4,3.0),'#8a5530'); k.box(4.6,3.8,0.25,(0,5.4,5.0),'#f5c021')
for sx in (-1,1):
    for j in range(5):
        k.cyl(0.33,0.08,(sx*(w(0.3+j*0.1)+0.02),8.5-17.0*(0.3+j*0.1)-0.0,2.1),'#ffe9a0',seg=8,m=RY(sx*pi/2),glow=1)
    for j in range(2): k.cyl(0.4,0.08,(sx*2.12,4.6+j*1.5,4.0),'#ffe9a0',seg=8,m=RY(sx*pi/2),glow=1)
    # side wing sails
    k.sheet(lambda u,v:(sx*(2.3+5.2*u), 3.2-5.5*v-1.2*u, 3.3+1.6*u-0.5*sin(pi*v)*u), 3, 3, '#f4f4ee')
    k.strut((sx*2.3,3.2,3.3),(sx*7.5,2.0,4.9),0.09,'#6e4424'); k.strut((sx*2.3,-2.3,3.3),(sx*7.5,-3.5,4.9),0.09,'#6e4424')
    # engines
    k.cyl(0.7,2.4,(sx*3.6,6.2,2.3),'#56607a',seg=8,m=RX(-pi/2),smooth=True)
    for b in range(3): k.box(0.3,0.08,2.6,(sx*3.6,8.75,2.3),'#f4f4ee',m=RY(b*pi/3)@T(0,0,-1.3))
    k.strut((sx*2.2,7.0,2.6),(sx*3.6,7.0,2.3),0.12,'#3b4252')
    for (y,zt) in ((-5.5,9.4),(-1.5,8.2),(2.5,8.2),(6.0,9.3)):
        k.strut((sx*w(0.5-y/17.0)*0.95,y,sheer(0.5-y/17.0)),(sx*3.0,y*1.15,zt),0.05,'#e9e2c8',seg=3)
# rudder + bow lantern + flag
k.prism([(0,0),(3.0,0.2),(3.4,3.4),(0,2.8)],0.2,at=(0,0,0),col='#e8372c',m=T(0,8.4,0.6)@RZ(-pi/2)@T(0,0,0))
k.strut((0,-8.5,3.6),(0,-10.6,4.3),0.1,'#6e4424',cap=True); k.sph(0.45,(0,-10.8,4.0),'#ffd76a',sub=1,glow=1)
k.strut((0,5.4,5.2),(0,5.4,7.4),0.06,'#f4f4ee'); k.poly([(0,5.4,7.4),(0,7.6,7.0),(0,5.4,6.5)],'#2f7fe8')
for i in range(4): person(k, (-1.2,1.0,-0.6,0.9)[i], (-3.5,-1.0,1.5,3.0)[i], sheer(0.6)-0.22, s=1.25)
k.pop()
R = k.done()
