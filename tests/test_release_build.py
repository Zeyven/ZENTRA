import importlib.util,tempfile,unittest,sys
from unittest.mock import patch
from pathlib import Path
spec=importlib.util.spec_from_file_location('release_build',Path(__file__).resolve().parents[1]/'scripts/release_build.py')
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
class Fingerprints(unittest.TestCase):
 def test_changed_bytes_with_same_mtime_are_rejected(self):
  import os
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'out').mkdir();p=root/'out/a.js';p.write_text('old');before=b.inventory(root,['out']);stamp=p.stat().st_mtime_ns
   p.write_text('new');os.utime(p,ns=(stamp,stamp))
   with self.assertRaises(ValueError):b.require_equal(before,b.inventory(root,['out']),'outputs')
 def test_deleted_and_extra_files_are_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'out').mkdir();p=root/'out/a.js';p.write_text('a');before=b.inventory(root,['out']);(root/'out/b.js').write_text('b')
   with self.assertRaises(ValueError):b.require_equal(before,b.inventory(root,['out']),'outputs')
   p.unlink()
   with self.assertRaises(ValueError):b.require_equal(before,b.inventory(root,['out']),'outputs')
 def test_missing_and_empty_directory_fail(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d)
   with self.assertRaises(ValueError):b.inventory(root,['out'])
   (root/'out').mkdir()
   with self.assertRaises(ValueError):b.inventory(root,['out'])
 def test_failed_preflight_invalidates_old_staging_without_ssh(self):
  import runpy,types
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'scripts').mkdir();(root/'.runtime').mkdir()
   (root/'scripts/stage-release.py').write_bytes((b.ROOT/'scripts/stage-release.py').read_bytes())
   record=root/'.runtime/staged-release.json';record.write_text('{"status":"ready"}')
   fake=types.ModuleType('release_build');fake.verify=lambda:(_ for _ in ()).throw(ValueError('Build is stale'));fake.node=lambda:None
   remote=types.ModuleType('remote');remote.connect=lambda:self.fail('Must not connect to production')
   with patch.dict(sys.modules,{'release_build':fake,'remote':remote}):
    with self.assertRaises(ValueError):runpy.run_path(str(root/'scripts/stage-release.py'))
   self.assertFalse(record.exists())
 def test_secret_scanner_does_not_join_separate_passwordless_urls(self):
  spec=importlib.util.spec_from_file_location('scanner',b.ROOT/'scripts/check-release-secrets.py');scanner=importlib.util.module_from_spec(spec);spec.loader.exec_module(scanner)
  self.assertEqual(scanner.findings(b"'postgres://user@127.0.0.1:15433/test','postgres://user@127.0.0.1:5433/test'"),[])
  synthetic=b'postgres'+b'://operator:'+b'example-secret'+b'@localhost/test'
  self.assertEqual(scanner.findings(synthetic),['database-credential'])
if __name__=='__main__':unittest.main()
