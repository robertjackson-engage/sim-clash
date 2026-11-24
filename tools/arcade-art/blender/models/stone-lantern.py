k = Kit('stone-lantern', 117)
ST='#b9b3a4'; ST2='#9c9688'
k.cyl(0.62,0.3,(0,0,-0.2),ST2,seg=6,r2=0.5); k.cyl(0.42,0.12,(0,0,0.1),ST,seg=6)
k.cyl(0.17,0.8,(0,0,0.2),ST,seg=6,r2=0.14); k.cyl(0.4,0.14,(0,0,1.0),ST2,seg=6,r2=0.46)
k.box(0.56,0.56,0.5,(0,0,1.14),ST)
for q in range(4):
    k.push(RZ(q*pi/2)); k.poly([(-0.16,-0.285,1.22),(0.16,-0.285,1.22),(0.16,-0.285,1.56),(-0.16,-0.285,1.56)],'#ffd76a',glow=1); k.pop()
def rf(u,v):
    a=2*pi*u+pi/4; sq=1/max(abs(cos(a)),abs(sin(a))); r=(0.12+0.88*v)*0.62*sq
    return (r*cos(a),r*sin(a),1.64+0.42*(1-v)**1.5+0.12*((sq-1)/0.414)**2*v*v)
k.sheet(rf,16,2,ST2,fj=0.06)
k.poly([rf(u/16,1.0) for u in range(16)],ST)
k.sph(0.11,(0,0,2.12),ST,sub=1,sc=(1,1,1.4)); k.rock(0.22,(0.45,0.3,0.0),'#6aaa3f',sub=1,sc=(1.2,1,0.4))
R = k.done()
