// Native binary file-copy stores, sharing the existing adf-files workflow.
import { webFields } from "./web-auth.js";
import {
  databaseFields,
  secretField as secret,
  textField as text,
  portField,
  type ConnectionField,
} from "./table-source.js";

/** The concrete linked-service and dataset location of a file store. */
export interface FileStore {
  id: string;
  title: string;
  docs: string;
  service: string;
  location: string;
  read: string;
  root?: string;
  fields: Record<string, ConnectionField>;
  defaults?: Record<string, unknown>;
}
const keys = {
  access_key: text("accessKeyId", "Object storage access key ID."),
  secret_key: secret("secretAccessKey", "Key Vault secret holding the storage secret access key."),
};
const login = {
  host: text("host", "File server host name."),
  port: portField,
  user: { ...databaseFields.user, native: "userName" },
  password: databaseFields.password,
};

/** Current file stores; bucket/container selectors come from the flow object. */
export const fileStores: FileStore[] = [
  {
    id: "http",
    title: "HTTP",
    docs: "http",
    service: "HttpServer",
    location: "HttpServerLocation",
    read: "HttpReadSettings",
    fields: {
      url: webFields.url,
      user: webFields.user,
      password: webFields.password,
      authentication: {
        ...webFields.authentication,
        values: ["Anonymous", "Basic"],
        description: "Anonymous by default; Basic requires user and password.",
      },
      auth_headers: { ...webFields.auth_headers, native: "authHeader" },
    },
    defaults: { authenticationType: "Anonymous", enableServerCertificateValidation: true },
  },
  {
    id: "azure-blob",
    title: "Azure Blob Storage",
    docs: "azure-blob-storage",
    service: "AzureBlobStorage",
    location: "AzureBlobStorageLocation",
    read: "AzureBlobStorageReadSettings",
    root: "container",
    fields: {
      url: text(
        "serviceEndpoint",
        "Blob service endpoint; the factory managed identity needs read access.",
      ),
    },
  },
  {
    id: "adls-gen2",
    title: "Azure Data Lake Storage Gen2",
    docs: "azure-data-lake-storage",
    service: "AzureBlobFS",
    location: "AzureBlobFSLocation",
    read: "AzureBlobFSReadSettings",
    root: "fileSystem",
    fields: {
      url: text("url", "ADLS dfs endpoint; the factory managed identity needs read access."),
    },
  },
  {
    id: "azure-files",
    title: "Azure Files",
    docs: "azure-file-storage",
    service: "AzureFileStorage",
    location: "AzureFileStorageLocation",
    read: "AzureFileStorageReadSettings",
    fields: {
      connection_string: secret(
        "connectionString",
        "Key Vault secret holding the Azure Files connection string.",
      ),
      share: text("fileShare", "File share to read."),
    },
  },
  {
    id: "amazon-s3",
    title: "Amazon S3",
    docs: "amazon-simple-storage-service",
    service: "AmazonS3",
    location: "AmazonS3Location",
    read: "AmazonS3ReadSettings",
    root: "bucketName",
    fields: keys,
  },
  {
    id: "s3-compatible",
    title: "Amazon S3 Compatible Storage",
    docs: "amazon-s3-compatible-storage",
    service: "AmazonS3Compatible",
    location: "AmazonS3CompatibleLocation",
    read: "AmazonS3CompatibleReadSettings",
    root: "bucketName",
    fields: { ...keys, url: text("serviceUrl", "S3-compatible service endpoint.") },
  },
  {
    id: "ftp",
    title: "FTP",
    docs: "ftp",
    service: "FtpServer",
    location: "FtpServerLocation",
    read: "FtpReadSettings",
    fields: login,
    defaults: {
      authenticationType: "Basic",
      enableSsl: true,
      enableServerCertificateValidation: true,
    },
  },
  {
    id: "sftp",
    title: "SFTP",
    docs: "sftp",
    service: "Sftp",
    location: "SftpLocation",
    read: "SftpReadSettings",
    fields: {
      ...login,
      host_key: text("hostKeyFingerprint", "Verified server host-key fingerprint."),
    },
    defaults: { authenticationType: "Basic", skipHostKeyValidation: false },
  },
  {
    id: "google-cloud-storage",
    title: "Google Cloud Storage",
    docs: "google-cloud-storage",
    service: "GoogleCloudStorage",
    location: "GoogleCloudStorageLocation",
    read: "GoogleCloudStorageReadSettings",
    root: "bucketName",
    fields: keys,
    defaults: { serviceUrl: "https://storage.googleapis.com" },
  },
  {
    id: "hdfs",
    title: "HDFS",
    docs: "hdfs",
    service: "Hdfs",
    location: "HdfsLocation",
    read: "HdfsReadSettings",
    fields: {
      url: text("url", "HDFS service URL."),
      user: { ...databaseFields.user, native: "userName" },
      password: databaseFields.password,
    },
    defaults: { authenticationType: "Windows" },
  },
  {
    id: "oracle-cloud-storage",
    title: "Oracle Cloud Storage",
    docs: "oracle-cloud-storage",
    service: "OracleCloudStorage",
    location: "OracleCloudStorageLocation",
    read: "OracleCloudStorageReadSettings",
    root: "bucketName",
    fields: { ...keys, url: text("serviceUrl", "Oracle object-storage compatibility endpoint.") },
  },
];
