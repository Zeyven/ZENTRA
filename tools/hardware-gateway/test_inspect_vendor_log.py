import base64
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from inspect_vendor_log import inspect, shape, INTERFACES


class InspectorTest(unittest.TestCase):
    def test_observed_add_clock_fields_keep_types_without_values(self):
        self.assertIn('AddClock', INTERFACES)
        result = shape({'pgid': 'private-page', 'funid': 'private-action',
                        'data': [{'lbbh': 'private-category', 'xxbh': 'private-item',
                                  'xxmc': 'private-name', 'xxbz': 'private-note', 'c': 3}]})
        encoded = json.dumps(result)
        self.assertNotIn('private-', encoded)
        self.assertIn('xxbh', encoded)
        self.assertIn('int', encoded)

    def test_shapes_without_credentials_or_business_values(self):
        secret = 'DO_NOT_EMIT_THIS_SECRET'
        request = {'url': 'ReportClock', 'head': {'from_session': secret},
                   'body': base64.b64encode(json.dumps([{'pgid': secret, 'funid': secret,
                           'data': [{'bh': secret, 'mc': secret, secret: secret}]}]).encode()).decode()}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder)/'sample.zip'
            with zipfile.ZipFile(path, 'w') as bundle:
                bundle.writestr('log', 'prefix request '+json.dumps(request)+' request.GetHead() ignored\n'
                                +'prefix request {broken\n')
            result = inspect(path, 'log')
        self.assertNotIn(secret, json.dumps(result))
        self.assertEqual(result['requests'], {'ReportClock': 1})
        self.assertEqual(result['unparsed_request_records'], 1)
        self.assertIn('funid', json.dumps(result['request_body_shapes']))


if __name__ == '__main__':
    unittest.main()
