"""Convert the explicitly downloaded UCI workbook into lossless typed CSV input."""
from pathlib import Path
import argparse
import csv
import datetime
import decimal
import hashlib
import json
import zipfile

from openpyxl import load_workbook


def prepare(archive, output):
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    with zipfile.ZipFile(archive) as source:
        members = [x for x in source.infolist() if not x.is_dir()]
        if len(members) != 1 or members[0].filename != 'Online Retail.xlsx' or members[0].file_size > 32*1024**2:
            raise ValueError('Expected one bounded original UCI workbook')
        original = source.read(members[0])
    workbook = output/'original.xlsx'
    workbook.write_bytes(original)
    book = load_workbook(workbook, read_only=True, data_only=True)
    try:
        if book.sheetnames != ['Online Retail']: raise ValueError('Unexpected source workbook sheets')
        rows = book['Online Retail'].iter_rows(values_only=True)
        names = ['InvoiceNo','StockCode','Description','Quantity','InvoiceDate','UnitPrice','CustomerID','Country']
        if list(next(rows)) != names: raise ValueError('Source columns changed')
        count = 0; first = None; last = None
        with (output/'transactions.csv').open('x', newline='', encoding='utf-8') as stream:
            writer = csv.writer(stream)
            writer.writerow(['source_row','invoice_no','stock_code','description','quantity','invoice_time','unit_price','customer_id','country'])
            for source_row, values in enumerate(rows, start=2):
                invoice, stock, description, quantity, when, price, customer, country = values
                if type(quantity) is not int or not isinstance(when, datetime.datetime):
                    raise ValueError('Invalid quantity/date at source row '+str(source_row))
                money = decimal.Decimal(str(price))
                if not money.is_finite() or money != money.quantize(decimal.Decimal('.0001')):
                    raise ValueError('Unit price needs more than four decimal places at row '+str(source_row))
                if customer is not None:
                    if isinstance(customer, (float, int)):
                        if int(customer) != customer: raise ValueError('Non-integral customer ID')
                        customer = str(int(customer))
                    else: customer = str(customer)
                writer.writerow([source_row,str(invoice),str(stock),description or '',quantity,when.isoformat(' '),format(money,'f'),customer or '',country or ''])
                first = when if first is None else min(first,when)
                last = when if last is None else max(last,when)
                count += 1
        if count != 541909: raise ValueError('Full UCI row count changed: '+str(count))
    finally:
        book.close()
    sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
    manifest = {'source':'UCI Online Retail','url':'https://archive.ics.uci.edu/static/public/352/online+retail.zip',
                'doi':'10.24432/C5BW33','license':'CC-BY-4.0','attribution':'Daqing Chen (2015), UCI Machine Learning Repository',
                'raw_zip_sha256':sha(archive),'workbook_sha256':sha(workbook),
                'csv_sha256':sha(output/'transactions.csv'),'rows':count,
                'min_timestamp':first.isoformat(),'max_timestamp':last.isoformat(),
                'timestamp_timezone':'source local timestamps; timezone not asserted',
                'currency':'GBP','row_transform':'one output per original row, no deletion or deduplication; exact decimal text',
                'customer_ids':'original anonymous dataset identifiers; missing values preserved'}
    (output/'source-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps(manifest))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args = parser.parse_args()
    prepare(args.archive,args.output)
