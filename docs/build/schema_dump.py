"""Dump the live MySQL schema (columns, keys, FKs) to JSON for the PDF appendix."""
import json, subprocess, sys
db = sys.argv[1]
def q(sql):
    out = subprocess.run(['mysql','-uroot','-N','-B',db,'-e',sql],capture_output=True,text=True,check=True).stdout
    return [l.split('\t') for l in out.strip('\n').split('\n') if l]
cols = q(f"SELECT table_name,column_name,column_type,is_nullable,column_key,IFNULL(column_default,''),extra FROM information_schema.columns WHERE table_schema='{db}' AND table_name<>'schema_migrations' ORDER BY table_name,ordinal_position")
idx = q(f"SELECT table_name,index_name,non_unique,GROUP_CONCAT(column_name ORDER BY seq_in_index) FROM information_schema.statistics WHERE table_schema='{db}' AND table_name<>'schema_migrations' GROUP BY table_name,index_name,non_unique")
fks = q(f"SELECT k.table_name,k.constraint_name,GROUP_CONCAT(k.column_name ORDER BY k.ordinal_position),k.referenced_table_name,GROUP_CONCAT(k.referenced_column_name ORDER BY k.ordinal_position),r.delete_rule FROM information_schema.key_column_usage k JOIN information_schema.referential_constraints r ON r.constraint_name=k.constraint_name AND r.constraint_schema=k.table_schema WHERE k.table_schema='{db}' AND k.referenced_table_name IS NOT NULL GROUP BY k.table_name,k.constraint_name,k.referenced_table_name,r.delete_rule")
t={}
for tn,c,ty,nl,key,df,ex in cols: t.setdefault(tn,{'cols':[],'idx':[],'fks':[]})['cols'].append(dict(name=c,type=ty,null=nl=='YES',key=key,default=df,extra=ex))
for tn,name,nu,cs in idx: t[tn]['idx'].append(dict(name=name,unique=nu=='0',cols=cs))
for tn,name,cs,rt,rc,rule in fks: t[tn]['fks'].append(dict(name=name,cols=cs,ref=f"{rt}({rc})",rule=rule))
json.dump(t,open(sys.argv[2],'w'),indent=1)
print(len(t),'tables')
