k = Kit('boat', 31)
fs,sheer,w=hull(k, 9.4, 3.3, 1.5, '#f4f4ee', deck='#c98f52', stripe='#e8372c', nu=10, nv=6)
k.tint(fs, lambda c,n: '#2f7fe8' if c.z<0.45 else None)
dz=sheer(0.5)-0.22
for (x,y) in ((-1.25,-1.6),(1.25,-1.6),(-1.3,2.2),(1.3,2.2)): k.cyl(0.06,2.25,(x,y,dz),'#f4f4ee',seg=5)
fs=k.sheet(lambda u,v:(-1.6+3.2*u,-2.0+4.6*v,dz+2.25+0.28*sin(pi*u)),8,2,'#ffd21f')
k.tint(fs, lambda c,n: '#f4f4ee' if int((c.x+1.6)/0.4)%2 else None)
for sx in (-1,1):
    fs=k.sheet(lambda u,v:(sx*1.6,-2.0+4.6*u,dz+2.25-0.38*v*(0.6+0.4*abs(sin(u*pi*6)))),12,1,'#e8372c')
k.box(0.5,3.2,0.45,(-1.0,0.3,dz),'#2f7fe8'); k.box(0.5,3.2,0.45,(1.0,0.3,dz),'#2f7fe8')
k.box(1.3,1.0,1.0,(0,-2.6,dz),'#f4f4ee'); k.box(1.2,0.08,0.5,(0,-3.1,dz+1.0),'#35d0ff',m=RX(radians(-25)))
k.cyl(0.07,5.0,(0,2.5,dz),'#f4f4ee',seg=6); k.sph(0.14,(0,2.5,dz+5.05),'#f5c021',sub=1)
top=Vector((0,2.5,dz+4.95)); bow=Vector((0,-4.6,sheer(1)+0.3)); stern=Vector((0,4.6,sheer(0)+0.5))
PC=['#e8372c','#ffd21f','#2f7fe8','#2fbf4a','#ff5fa8','#f4f4ee']
for (a,b,n) in ((bow,top,10),(top,stern,5)):
    k.strut(a,b,0.02,'#e9e2c8',seg=3)
    for i in range(n):
        p=a+(b-a)*((i+0.3)/n); q=a+(b-a)*((i+0.8)/n); m=(p+q)/2
        k.poly([tuple(p),tuple(q),(m.x,m.y,m.z-0.5)],PC[i%6])
k.strut((0,4.55,sheer(0)-0.1),(0,5.0,sheer(0)+1.5),0.035,'#f4f4ee'); k.poly([(0,5.0,sheer(0)+1.5),(0,6.0,sheer(0)+1.3),(0,5.0,sheer(0)+0.9)],'#e8372c')
k.box(0.5,0.6,1.0,(0,4.85,0.5),'#3b4252'); k.box(0.55,0.4,0.4,(0,4.85,1.5),'#e8372c')
for sx in (-1,1):
    k.cyl(0.36,0.14,(sx*(w(0.45)+0.03),0.4,1.0),'#ff8a1f',seg=8,m=RY(sx*pi/2)); k.cyl(0.2,0.16,(sx*(w(0.45)+0.03),0.4,1.0),'#f4f4ee',seg=8,m=RY(sx*pi/2))
k.sph(0.2,(0,-4.3,sheer(1)+0.1),'#ffe9a0',sub=1,glow=1)
for (x,y,ar) in ((-0.55,-1.2,True),(0.5,-0.6,False),(-0.3,0.5,True),(0.55,1.3,True),(0.0,-3.6,False),(-0.5,3.3,True)):
    person(k,x,y,dz,arms=ar)
R = k.done()
