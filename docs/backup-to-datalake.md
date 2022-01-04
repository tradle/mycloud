Below is a concise description of how the job implemented in athenafeed.ts
does the export of tradle objects (creates data lake).

1. Any write into dynamoDb is duplicated by creating a file in S3 into which the
   object content is dumped. For a never modified object it will be a single file.
   For modified objects there will be as many files as the object versions.
   The object's bucket name follows the pattern "tdl-....-ltd-dev-buckets-...-objects-..."
   
   The function of the athenafeed job is to pick up the files from the objects bucket and
   merge the object files of the same type into a single file.
   The end result is maintenance in S3 of files to which the new objects are appended
   and existing objects updated.
   The export files are placed in S3 bucket with name pattern
     "tdl-...-ltd-dev-buckets-...-privateconf-..." in data_export/ folder.    

2. Now how it works.
   The run time of the job is limited by Lambda hard set limit of 15 minutes.
   So at every job invocation for  ~ 10 minutes it does the following:
    - collects into memory all file names found in objects bucket
    - sort them by file timestamp
    - maintains marker file with the name of last processed object
    - starting from file following the marker reads objects into memory to discover
      an object type and permalink.
    - opens write file stream into local /tmp for every type encountered and appends
      the object content as a string line
    - when the time limit is reached closes the file streams

   After that the job starts downloading from S3 export files for a type which
    need to be appended/updated.
    - there maintained two files per type where
      one contains the aggregated objects json lines and
      another array of all permalinks of objects from the first file
   (index file for a speedy update)
    - the export objects file is downloaded and merged with a file
 of the same type found in /temp, the result uploaded back as a replacement,
      also updated permalink index file uploaded as a replacement.
    - marker file refreshed to contain the last processed object name.

   Creates Athena tables, one per exported data type if not yet exists.
