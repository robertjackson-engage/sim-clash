k = Kit('balloon', 139)
GC=['#e8372c','#ffd21f','#2f7fe8','#f4f4ee','#2fbf4a','#ff8a1f']
N=10; prof=[]
for i in range(N+1):
    t=i/N; a=pi*t
    prof.append((max(0.0,7.2*sin(a)**0.8*(0.55+0.45*t)) if 0<t<1 else (1.3 if t==0 else 0.0), 7.0+15.0*t**0.85))
fs=k.lathe(prof,12,col=GC[0],smooth=True)
k.tint(fs, lambda c,n: GC[int((atan2(c.y,c.x)+pi)/(2*pi)*12+0.001)%6] if c.z>7.05 else None)
k.lathe([(1.35,6.6),(1.35,7.2)],12,col='#f5c021')
for j in range(12):
    a=j*pi/6
    k.poly([(4.9*cos(a-0.2),4.9*sin(a-0.2),11.6),(4.9*cos(a+0.2),4.9*sin(a+0.2),11.6),(5.05*cos(a),5.05*sin(a),10.6)],GC[(j+3)%6])
k.box(2.0,2.0,1.5,(0,0,0),'#a0683a',fj=0.08); k.box(2.2,2.2,0.2,(0,0,1.4),'#6e4424')
for (a,b) in ((-1,-1),(1,-1),(1,1),(-1,1)):
    k.strut((a*1.0,b*1.0,1.5),(a*0.95,b*0.95,6.7),0.035,'#e9dfbf',seg=3)
    k.sph(0.3,(a*1.15,b*1.15,0.5),'#d8322a',sub=1,sc=(0.6,0.6,1))
k.cyl(0.28,0.5,(0,0,5.6),'#3b4252',seg=6); flame(k,(0,0,6.0),0.3,1.2)
person(k,-0.35,-0.3,0.3,mode='bust',arms=True,s=1.3); person(k,0.4,0.3,0.3,mode='bust',s=1.3)
R = k.done()
